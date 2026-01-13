// lib/db/utils/getWorkspaceId.ts
import { getCurrentUser } from "@/auth";
import { getOrCreateWorkspace, getWorkspaceIdBySpreadsheetId } from "../services/workspace";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { cookies } from "next/headers";
import { auth } from "@/auth";

/**
 * Get workspace ID for the current user.
 * Uses spreadsheet ID from cookie/session to find or create workspace.
 */
export async function getWorkspaceIdForUser(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user || !user.userId) {
    return null;
  }

  // Get spreadsheet ID from cookie or session
  const cookieStore = await cookies();
  const cookieSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

  let spreadsheetId: string | null = null;
  if (cookieSpreadsheetId) {
    spreadsheetId = cookieSpreadsheetId;
  } else {
    // Check session/JWT token
    const session = await auth();
    const sessionSpreadsheetId = session
      ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId || null
      : null;
    spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
  }

  if (!spreadsheetId) {
    return null;
  }

  // Get or create workspace
  const workspaceId = await getOrCreateWorkspace(spreadsheetId, user.userId);
  return workspaceId;
}
