/**
 * API route to get workspace information (folder name, sheet name) from the Config tab.
 * 
 * GET /api/user-settings/workspace-info
 * Returns: { folderName, sheetName, folderId, spreadsheetId } or null if not configured
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadWorkspaceConfig } from "@/lib/google/workspaceConfig";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google authentication required" },
        { status: 401 }
      );
    }

    // Get spreadsheet ID from cookie or session
    const cookieStore = await cookies();
    const cookieSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
    
    let spreadsheetId: string | null = cookieSpreadsheetId;
    
    if (!spreadsheetId) {
      // Check session/JWT token
      const { auth } = await import("@/auth");
      const session = await auth();
      spreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId || null : null;
    }

    if (!spreadsheetId) {
      return NextResponse.json({ 
        folderName: null,
        sheetName: null,
        folderId: null,
        spreadsheetId: null,
      });
    }

    // Load workspace config from Config tab
    const config = await loadWorkspaceConfig(user.googleAccessToken, spreadsheetId);
    
    if (!config) {
      // Config tab doesn't exist or is empty (legacy spreadsheet)
      return NextResponse.json({
        folderName: null,
        sheetName: null,
        folderId: cookieStore.get("googleDriveFolderId")?.value || null,
        spreadsheetId,
      });
    }

    return NextResponse.json({
      folderName: config.folderName || null,
      sheetName: config.sheetName || null,
      folderId: config.folderId || cookieStore.get("googleDriveFolderId")?.value || null,
      spreadsheetId: config.spreadsheetId || spreadsheetId,
    });
  } catch (error) {
    console.error("Error getting workspace info:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

