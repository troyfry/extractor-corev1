/**
 * Workspace configuration contract.
 * 
 * This is the single source of truth for workspace state.
 * Persisted in Users Sheet, cached in cookies for fast access.
 */

import type { WorkspaceLabels } from "@/lib/google/gmailLabels";

export type WorkspaceConfig = {
  spreadsheetId: string;
  driveFolderId: string;
  fmProfiles: string[]; // normalized fmKeys
  templatesConfigured: boolean;
  onboardingCompletedAt: string;
  // Gmail labels (state machine)
  labels: WorkspaceLabels;
  // Legacy fields (for backward compatibility during migration)
  gmailWorkOrdersLabelName?: string;
  gmailWorkOrdersLabelId?: string;
  gmailSignedLabelName?: string;
  gmailSignedLabelId?: string;
  gmailProcessedLabelName?: string | null;
  gmailProcessedLabelId?: string | null;
};

