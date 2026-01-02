/**
 * Rehydrate cookies from workspace data.
 * 
 * This is called when workspace is loaded from Users Sheet to set cookies
 * for faster access on subsequent requests.
 */

import { cookies } from "next/headers";
import type { WorkspaceConfig } from "@/types/workspace";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60, // 30 days
};

/**
 * Set workspace cookies from workspace data.
 * This makes subsequent requests faster (cookie path).
 */
export async function rehydrateCookies(workspace: WorkspaceConfig): Promise<void> {
  const cookieStore = await cookies();
  
  cookieStore.set("workspaceReady", "true", COOKIE_OPTIONS);
  cookieStore.set("workspaceSpreadsheetId", workspace.spreadsheetId, COOKIE_OPTIONS);
  cookieStore.set("workspaceDriveFolderId", workspace.driveFolderId, COOKIE_OPTIONS);
  cookieStore.set("onboardingCompletedAt", workspace.onboardingCompletedAt, COOKIE_OPTIONS);
  
  // Legacy cookies for backward compatibility
  cookieStore.set("googleSheetsSpreadsheetId", workspace.spreadsheetId, COOKIE_OPTIONS);
  cookieStore.set("googleDriveFolderId", workspace.driveFolderId, COOKIE_OPTIONS);
  cookieStore.set("onboardingCompleted", "true", COOKIE_OPTIONS);
  
  // Gmail label cookies
  cookieStore.set("gmailWorkOrdersLabelName", workspace.gmailWorkOrdersLabelName, COOKIE_OPTIONS);
  cookieStore.set("gmailWorkOrdersLabelId", workspace.gmailWorkOrdersLabelId, COOKIE_OPTIONS);
  cookieStore.set("gmailSignedLabelName", workspace.gmailSignedLabelName, COOKIE_OPTIONS);
  cookieStore.set("gmailSignedLabelId", workspace.gmailSignedLabelId, COOKIE_OPTIONS);
  
  if (workspace.gmailProcessedLabelName) {
    cookieStore.set("gmailProcessedLabelName", workspace.gmailProcessedLabelName, COOKIE_OPTIONS);
  }
  if (workspace.gmailProcessedLabelId) {
    cookieStore.set("gmailProcessedLabelId", workspace.gmailProcessedLabelId, COOKIE_OPTIONS);
  }
}

