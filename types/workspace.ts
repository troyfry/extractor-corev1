/**
 * Workspace configuration contract.
 * 
 * This is the single source of truth for workspace state.
 * Persisted in Users Sheet, cached in cookies for fast access.
 */

export type WorkspaceConfig = {
  spreadsheetId: string;
  driveFolderId: string;
  fmProfiles: string[]; // normalized fmKeys
  templatesConfigured: boolean;
  onboardingCompletedAt: string;
};

