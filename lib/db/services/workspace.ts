// lib/db/services/workspace.ts
import { db } from "../drizzle";
import { workspaces, workspace_members } from "../schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";


/**
 * Get or create workspace by drive folder ID (DB-native).
 * Returns workspace ID.
 * 
 * @param driveFolderId - Drive folder ID (required)
 * @param userId - User ID
 * @param spreadsheetId - Optional spreadsheet ID (only if export_enabled=true)
 * @param workspaceName - Optional workspace name
 */
export async function getOrCreateWorkspace(
  driveFolderId: string,
  userId: string,
  spreadsheetId?: string | null,
  workspaceName?: string | null
): Promise<string> {
  // Try to find existing workspace by drive folder ID
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.drive_folder_id, driveFolderId))
    .limit(1);

  if (existing.length > 0) {
    const workspaceId = existing[0].id;

    // Update spreadsheet_id if provided and different
    if (spreadsheetId && existing[0].spreadsheet_id !== spreadsheetId) {
      await db
        .update(workspaces)
        .set({
          spreadsheet_id: spreadsheetId,
          export_enabled: true,
          updated_at: new Date(),
        })
        .where(eq(workspaces.id, workspaceId));
    }

    // Ensure user is a member
    const member = await db
      .select()
      .from(workspace_members)
      .where(
        and(
          eq(workspace_members.workspace_id, workspaceId),
          eq(workspace_members.user_id, userId)
        )
      )
      .limit(1);

    if (member.length === 0) {
      await db.insert(workspace_members).values({
        workspace_id: workspaceId,
        user_id: userId,
        role: "owner",
      });
    }

    return workspaceId;
  }

  // Create new workspace
  const workspaceId = randomUUID();
  await db.insert(workspaces).values({
    id: workspaceId,
    drive_folder_id: driveFolderId,
    spreadsheet_id: spreadsheetId || null,
    export_enabled: !!spreadsheetId,
    name: workspaceName || `Workspace ${driveFolderId.substring(0, 8)}`,
    primary_read_source: "DB", // Default to DB for new workspaces
  });

  // Add user as owner
  await db.insert(workspace_members).values({
    workspace_id: workspaceId,
    user_id: userId,
    role: "owner",
  });

  return workspaceId;
}

/**
 * Get workspace ID by spreadsheet ID (for backward compatibility).
 * Returns workspace ID or null if not found.
 */
export async function getWorkspaceIdBySpreadsheetId(
  spreadsheetId: string
): Promise<string | null> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.spreadsheet_id, spreadsheetId))
    .limit(1);

  return workspace?.id || null;
}

/**
 * Get primary read source for a workspace.
 * Returns 'LEGACY' or 'DB', defaulting to 'LEGACY'.
 */
export async function getPrimaryReadSource(
  workspaceId: string
): Promise<"LEGACY" | "DB"> {
  const [workspace] = await db
    .select({ primary_read_source: workspaces.primary_read_source })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) {
    return "LEGACY"; // Default if workspace not found
  }

  return (workspace.primary_read_source === "DB" ? "DB" : "LEGACY") as "LEGACY" | "DB";
}

/**
 * Set primary read source for a workspace.
 * Admin-only operation (caller should verify permissions).
 */
export async function setPrimaryReadSource(
  workspaceId: string,
  source: "LEGACY" | "DB"
): Promise<void> {
  await db
    .update(workspaces)
    .set({
      primary_read_source: source,
      updated_at: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));
}

/**
 * Get workspace by ID.
 * Returns workspace or null if not found.
 */
export async function getWorkspaceById(workspaceId: string) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return workspace || null;
}

/**
 * Get workspace by user ID (returns the user's primary workspace).
 * Returns workspace ID or null if not found.
 */
export async function getWorkspaceIdByUserId(userId: string): Promise<string | null> {
  const [member] = await db
    .select({ workspace_id: workspace_members.workspace_id })
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
    .limit(1);

  return member?.workspace_id || null;
}

/**
 * Update workspace config (Gmail labels, onboarding completion, etc.).
 */
export async function updateWorkspaceConfig(
  workspaceId: string,
  config: {
    gmailBaseLabelName?: string | null;
    gmailBaseLabelId?: string | null;
    gmailQueueLabelId?: string | null;
    gmailSignedLabelId?: string | null;
    gmailProcessedLabelId?: string | null;
    onboardingCompletedAt?: Date | null;
    spreadsheetId?: string | null;
    exportEnabled?: boolean;
  }
): Promise<void> {
  const updateData: Record<string, any> = {
    updated_at: new Date(),
  };

  if (config.gmailBaseLabelName !== undefined) updateData.gmail_base_label_name = config.gmailBaseLabelName;
  if (config.gmailBaseLabelId !== undefined) updateData.gmail_base_label_id = config.gmailBaseLabelId;
  if (config.gmailQueueLabelId !== undefined) updateData.gmail_queue_label_id = config.gmailQueueLabelId;
  if (config.gmailSignedLabelId !== undefined) updateData.gmail_signed_label_id = config.gmailSignedLabelId;
  if (config.gmailProcessedLabelId !== undefined) updateData.gmail_processed_label_id = config.gmailProcessedLabelId;
  if (config.onboardingCompletedAt !== undefined) updateData.onboarding_completed_at = config.onboardingCompletedAt;
  if (config.spreadsheetId !== undefined) updateData.spreadsheet_id = config.spreadsheetId;
  if (config.exportEnabled !== undefined) updateData.export_enabled = config.exportEnabled;

  await db
    .update(workspaces)
    .set(updateData)
    .where(eq(workspaces.id, workspaceId));
}
