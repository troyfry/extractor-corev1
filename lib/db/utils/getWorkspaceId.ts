// lib/db/utils/getWorkspaceId.ts
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getWorkspaceIdByUserId, getWorkspaceIdBySpreadsheetId } from "../services/workspace";
import { cookies } from "next/headers";

/**
 * Get workspace ID for the current user.
 * DB-native: Uses workspaceId cookie first, then looks up by user ID.
 * Falls back to spreadsheet ID lookup for backward compatibility.
 */
export async function getWorkspaceIdForUser(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user || !user.userId) {
    return null;
  }

  // First, check for workspaceId cookie (DB-native)
  const cookieStore = await cookies();
  const cookieWorkspaceId = cookieStore.get("workspaceId")?.value || null;
  
  if (cookieWorkspaceId) {
    return cookieWorkspaceId;
  }

  // Second, try to find workspace by user ID
  const workspaceId = await getWorkspaceIdByUserId(user.userId);
  if (workspaceId) {
    return workspaceId;
  }

  // Fallback: try spreadsheet ID lookup (for backward compatibility)
  const cookieSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
  if (cookieSpreadsheetId) {
    return await getWorkspaceIdBySpreadsheetId(cookieSpreadsheetId);
  }

  return null;
}
