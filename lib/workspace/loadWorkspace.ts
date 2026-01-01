/**
 * Load workspace configuration.
 * 
 * Priority:
 * 1. Cookie (workspaceReady=true) → trust it, return cached values
 * 2. Users Sheet → load once, set cookies, return
 * 
 * Never reads Sheets if cookie exists.
 * Never redirects on quota errors.
 */

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById } from "@/lib/onboarding/usersSheet";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import type { WorkspaceConfig } from "@/types/workspace";

/**
 * Load workspace configuration.
 * 
 * @returns Workspace configuration or null if not found
 */
export async function loadWorkspace(): Promise<WorkspaceConfig | null> {
  const cookieStore = await cookies();
  const user = await getCurrentUser();

  if (!user || !user.userId) {
    return null;
  }

  // 1️⃣ Fast path — cookie says workspaceReady=true → trust it
  const workspaceReady = cookieStore.get("workspaceReady")?.value;
  if (workspaceReady === "true") {
    // Get cached values from cookies (hints, not truth)
    const spreadsheetId = cookieStore.get("workspaceSpreadsheetId")?.value ||
      cookieStore.get("googleSheetsSpreadsheetId")?.value;
    const driveFolderId = cookieStore.get("workspaceDriveFolderId")?.value ||
      cookieStore.get("googleDriveFolderId")?.value;

    if (spreadsheetId && driveFolderId) {
      // Return workspace from cookies (fast path, no Sheets calls)
      // Note: FM profiles and templatesConfigured are not in cookies
      // They'll be loaded separately when needed
      return {
        spreadsheetId,
        driveFolderId,
        fmProfiles: [], // Not stored in cookies, load separately
        templatesConfigured: false, // Not stored in cookies, check separately
        onboardingCompletedAt: cookieStore.get("onboardingCompletedAt")?.value || new Date().toISOString(),
      };
    }
  }

  // 2️⃣ Load from Users Sheet (source of truth)
  if (!user.googleAccessToken) {
    return null;
  }

  try {
    // Get main spreadsheet ID (where Users sheet is stored)
    const mainSpreadsheetId = await getUserSpreadsheetId(user.userId);
    if (!mainSpreadsheetId) {
      console.warn("[Workspace] Cannot find mainSpreadsheetId - cannot load from Users Sheet");
      return null;
    }

    // Load user row from Users sheet
    const userRow = await getUserRowById(
      user.googleAccessToken,
      mainSpreadsheetId,
      user.userId
    );

    if (!userRow || userRow.onboardingCompleted !== "TRUE") {
      return null;
    }

    // Guardrail: workspaceReady=true but Users sheet missing
    if (workspaceReady === "true" && !userRow.spreadsheetId) {
      console.warn("[Workspace] Guardrail: workspaceReady=true but Users sheet missing workspace data");
    }

    // Parse FM profiles from JSON
    let fmProfiles: string[] = [];
    if (userRow.fmProfilesJson) {
      try {
        fmProfiles = JSON.parse(userRow.fmProfilesJson);
      } catch (error) {
        console.warn("[Workspace] Failed to parse fmProfilesJson:", error);
      }
    }

    const workspace: WorkspaceConfig = {
      spreadsheetId: userRow.spreadsheetId || userRow.mainSpreadsheetId || mainSpreadsheetId,
      driveFolderId: userRow.driveFolderId || userRow.signedFolderId || "",
      fmProfiles,
      templatesConfigured: userRow.templatesConfigured === "TRUE",
      onboardingCompletedAt: userRow.onboardingCompletedAt || userRow.updatedAt || new Date().toISOString(),
    };

    // Re-set cookies for next request (fast path)
    // Note: cookies() is read-only in this context, so cookies will be set by calling route
    // Return workspace data so caller can set cookies via NextResponse

    return workspace;
  } catch (error) {
    // Never redirect on quota errors - just return null
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isQuotaError = errorMessage.includes("quota") || 
                        errorMessage.includes("rate limit") ||
                        errorMessage.includes("429");
    
    if (isQuotaError) {
      console.warn("[Workspace] Quota error loading workspace - returning null (no redirect)");
      return null;
    }

    console.error("[Workspace] Error loading from Users Sheet:", error);
    return null;
  }
}

