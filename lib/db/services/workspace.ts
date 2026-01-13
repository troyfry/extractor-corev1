// lib/db/services/workspace.ts
import { db } from "../drizzle";
import { workspaces, workspace_members } from "../schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Get workspace ID by spreadsheet ID.
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
 * Get or create workspace by spreadsheet ID.
 * Returns workspace ID.
 */
export async function getOrCreateWorkspace(
  spreadsheetId: string,
  userId: string,
  driveFolderId?: string | null
): Promise<string> {
  // Try to find existing workspace
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.spreadsheet_id, spreadsheetId))
    .limit(1);

  if (existing.length > 0) {
    const workspaceId = existing[0].id;

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
    spreadsheet_id: spreadsheetId,
    drive_folder_id: driveFolderId || null,
    name: `Workspace ${spreadsheetId.substring(0, 8)}`,
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
