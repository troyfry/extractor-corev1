/**
 * API route to list/search Google Drive folders.
 * 
 * GET /api/user-settings/list-folders?q=searchTerm
 * Returns: Array of { id, name } folders
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { createDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const searchTerm = searchParams.get("q") || "";

    const drive = createDriveClient(user.googleAccessToken);

    // Build search query
    let query = "mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (searchTerm) {
      // Search by name (case-insensitive partial match)
      query += ` and name contains '${searchTerm.replace(/'/g, "\\'")}'`;
    }

    const response = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      pageSize: 20, // Limit to 20 results
      orderBy: "modifiedTime desc", // Most recently modified first
    });

    const folders = (response.data.files || []).map((file) => ({
      id: file.id || "",
      name: file.name || "",
    }));

    return NextResponse.json({ folders });
  } catch (error) {
    console.error("Error listing folders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

