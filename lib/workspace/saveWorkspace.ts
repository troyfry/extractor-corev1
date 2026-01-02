/**
 * Save workspace configuration to Users Sheet.
 * 
 * This is the single write point for workspace state.
 * Called once at the end of onboarding.
 */

import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { upsertUserRow } from "@/lib/onboarding/usersSheet";
import type { WorkspaceConfig } from "@/types/workspace";

/**
 * Save workspace configuration to Users Sheet.
 * 
 * @param userId - User ID
 * @param workspace - Workspace configuration to save
 */
export async function saveWorkspaceConfig(
  userId: string,
  workspace: WorkspaceConfig
): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !user.userId || user.userId !== userId) {
    throw new Error("User not authenticated or userId mismatch");
  }

  if (!user.googleAccessToken) {
    throw new Error("Google access token not available");
  }

  // Get main spreadsheet ID (where Users sheet is stored)
  const mainSpreadsheetId = await getUserSpreadsheetId(userId);
  if (!mainSpreadsheetId) {
    throw new Error("Spreadsheet ID not found. Please complete Google Sheets setup first.");
  }

  // Serialize FM profiles to JSON
  const fmProfilesJson = JSON.stringify(workspace.fmProfiles || []);

  // Upsert workspace config in Users sheet
  await upsertUserRow(user.googleAccessToken, mainSpreadsheetId, {
    userId,
    email: user.email || "",
    spreadsheetId: workspace.spreadsheetId,
    driveFolderId: workspace.driveFolderId,
    fmProfilesJson,
    templatesConfigured: workspace.templatesConfigured ? "TRUE" : "FALSE",
    onboardingCompletedAt: workspace.onboardingCompletedAt,
    gmailWorkOrdersLabelName: workspace.gmailWorkOrdersLabelName || "",
    gmailWorkOrdersLabelId: workspace.gmailWorkOrdersLabelId || "",
    gmailSignedLabelName: workspace.gmailSignedLabelName || "",
    gmailSignedLabelId: workspace.gmailSignedLabelId || "",
    gmailProcessedLabelName: workspace.gmailProcessedLabelName || "",
    gmailProcessedLabelId: workspace.gmailProcessedLabelId || "",
    onboardingCompleted: "TRUE",
    updatedAt: new Date().toISOString(),
  }, { allowEnsure: true });

  console.log(`[Workspace] Saved workspace config for user ${userId}`);
}

