/**
 * Workspace types and definitions.
 * 
 * A UserWorkspace represents a complete onboarding setup.
 * It is created once and persisted in the Users Sheet.
 */

export type UserWorkspace = {
  userId: string;
  email: string;
  spreadsheetId: string;
  mainSheetName: string; // Usually "Sheet1" or "Work_Orders"
  workOrdersSheetName: string; // Usually "Work_Orders"
  templatesSheetName: string; // Usually "Templates"
  driveSignedFolderId: string;
  driveSnippetsFolderId: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Workspace columns in the Users Sheet.
 * This is the source of truth for user workspace configuration.
 */
export const USERS_SHEET_WORKSPACE_COLUMNS = [
  "user_id",
  "email",
  "spreadsheet_id",
  "main_sheet",
  "work_orders_sheet",
  "templates_sheet",
  "signed_folder_id",
  "snippets_folder_id",
  "onboarding_completed",
  "created_at",
  "updated_at",
] as const;

