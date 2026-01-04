/**
 * Universal workspace loader (PURE - no side effects).
 * 
 * This is the single function that every route uses to get workspace configuration.
 * 
 * Priority order:
 * 1. Cookies (fast, zero API calls) - validated for version
 * 2. Users Sheet (source of truth)
 * 
 * NEVER writes cookies - use rehydrateWorkspaceCookies() in API routes instead.
 * Never redirects to onboarding unless BOTH are missing.
 */

import { cookies } from "next/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById } from "@/lib/onboarding/usersSheet";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { readWorkspaceCookies, validateWorkspaceVersion } from "./workspaceCookies";
import type { UserWorkspace } from "./types";

export type WorkspaceResult = {
  workspace: UserWorkspace;
  source: "cookie" | "users_sheet";
} | null;

/**
 * Get user workspace configuration (PURE LOADER - no cookie writing).
 * 
 * Fast path: Check cookies first (zero API calls)
 * Fallback: Load from Users Sheet (source of truth)
 * 
 * @returns Workspace configuration or null if not found
 */
export async function getWorkspace(): Promise<WorkspaceResult> {
  const cookieStore = await cookies();
  const user = await getCurrentUser();
  
  if (!user || !user.userId) {
    return null;
  }

  // 1️⃣ Fast path — cookies (zero API calls)
  const wsCookies = readWorkspaceCookies(cookieStore);
  
  // Validate workspace version (if present)
  if (!validateWorkspaceVersion(cookieStore)) {
    console.log("[Workspace] Cookie version mismatch - will reload from Users Sheet");
    // Fall through to Users Sheet load
  } else if (wsCookies.spreadsheetId && wsCookies.onboardingCompleted === "true") {
    // We have valid cookies, construct workspace from cookies
    // Note: We don't have all fields in cookies, so we use defaults for missing ones
    return {
      workspace: {
        userId: user.userId,
        email: user.email || "",
        spreadsheetId: wsCookies.spreadsheetId,
        mainSheetName: "Sheet1", // Default
        workOrdersSheetName: "Work_Orders", // Default
        templatesSheetName: "Templates", // Default
        driveSignedFolderId: wsCookies.folderId || "",
        driveSnippetsFolderId: wsCookies.folderId || "", // Default to same folder
        onboardingCompleted: true,
        createdAt: wsCookies.onboardingCompletedAt || new Date().toISOString(),
        updatedAt: wsCookies.onboardingCompletedAt || new Date().toISOString(),
      },
      source: "cookie",
    };
  }

  // 2️⃣ Restore from Users Sheet (source of truth)
  if (!user.googleAccessToken) {
    return null;
  }

  try {
    // Get mainSpreadsheetId from multiple sources (in priority order):
    // 1. Cookie (fast, but expires after 30 days)
    // 2. Session/JWT token (persists across cookie expiration) ✅
    // 3. Direct user property (fallback)
    const sessionSpreadsheetId = await getUserSpreadsheetId(user.userId);
    const mainSpreadsheetId = wsCookies.spreadsheetId || 
      sessionSpreadsheetId ||
      (user as any).googleSheetsSpreadsheetId || 
      null;
    
    if (!mainSpreadsheetId) {
      // No way to find Users sheet without main spreadsheet ID
      // This should be rare - spreadsheet ID should be in JWT token from onboarding
      console.warn("[Workspace] Cannot find mainSpreadsheetId - cannot restore from Users Sheet");
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

    // Extract workspace from user row
    // Use spreadsheetId if available, otherwise fall back to mainSpreadsheetId
    const workspaceSpreadsheetId = userRow.spreadsheetId || userRow.mainSpreadsheetId || mainSpreadsheetId;
    
    if (!workspaceSpreadsheetId) {
      return null;
    }

    const workspace: UserWorkspace = {
      userId: user.userId,
      email: user.email || userRow.email || "",
      spreadsheetId: workspaceSpreadsheetId,
      mainSheetName: userRow.mainSheet || "Sheet1",
      workOrdersSheetName: userRow.workOrdersSheet || "Work_Orders",
      templatesSheetName: userRow.templatesSheet || "Templates",
      driveSignedFolderId: userRow.signedFolderId || userRow.driveFolderId || "",
      driveSnippetsFolderId: userRow.snippetsFolderId || userRow.driveFolderId || "",
      onboardingCompleted: true,
      createdAt: userRow.createdAt || new Date().toISOString(),
      updatedAt: userRow.updatedAt || new Date().toISOString(),
    };

    // NOTE: This function does NOT write cookies (pure loader)
    // Callers should use rehydrateWorkspaceCookies() if workspace was loaded from Users Sheet

    return {
      workspace,
      source: "users_sheet",
    };
  } catch (error) {
    console.error("[Workspace] Error loading from Users Sheet:", error);
    return null;
  }
}

