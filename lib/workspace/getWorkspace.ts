/**
 * Universal workspace loader.
 * 
 * This is the single function that every route uses to get workspace configuration.
 * 
 * Priority order:
 * 1. Cookies (fast, zero API calls)
 * 2. Users Sheet (source of truth, rehydrates cookies)
 * 
 * Never redirects to onboarding unless BOTH are missing.
 */

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById } from "@/lib/onboarding/usersSheet";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import type { UserWorkspace } from "./types";

export type WorkspaceResult = {
  workspace: UserWorkspace;
  source: "cookie" | "users_sheet";
} | null;

/**
 * Get user workspace configuration.
 * 
 * Fast path: Check cookies first (zero API calls)
 * Fallback: Load from Users Sheet and rehydrate cookies
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
  const cookieSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value;
  const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
  const cookieFolderId = cookieStore.get("googleDriveFolderId")?.value;
  
  if (cookieSpreadsheetId && cookieOnboardingCompleted === "true") {
    // We have cookies, construct workspace from cookies
    // Note: We don't have all fields in cookies, so we use defaults for missing ones
    return {
      workspace: {
        userId: user.userId,
        email: user.email || "",
        spreadsheetId: cookieSpreadsheetId,
        mainSheetName: "Sheet1", // Default
        workOrdersSheetName: "Work_Orders", // Default
        templatesSheetName: "Templates", // Default
        driveSignedFolderId: cookieFolderId || "",
        driveSnippetsFolderId: cookieFolderId || "", // Default to same folder
        onboardingCompleted: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
    const mainSpreadsheetId = cookieSpreadsheetId || 
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

    // 3️⃣ Rehydrate cookies for next request (note: cookies() is read-only in this context)
    // Cookies will be set by the calling route/API handler
    // We return the workspace data so the caller can set cookies

    return {
      workspace,
      source: "users_sheet",
    };
  } catch (error) {
    console.error("[Workspace] Error loading from Users Sheet:", error);
    return null;
  }
}

