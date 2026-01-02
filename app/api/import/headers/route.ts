/**
 * API route to read headers from external spreadsheet (READ-ONLY).
 * 
 * NEVER writes to external sheets. Only reads headers.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { readExternalHeaders } from "@/lib/importer/readExternalSheet";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.googleAccessToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const externalSpreadsheetId = searchParams.get("spreadsheetId");
    const sheetName = searchParams.get("sheetName") || "Sheet1";

    if (!externalSpreadsheetId) {
      return NextResponse.json(
        { error: "spreadsheetId is required" },
        { status: 400 }
      );
    }

    // READ-ONLY: Only read headers, never write
    const headers = await readExternalHeaders(
      user.googleAccessToken,
      externalSpreadsheetId,
      sheetName
    );

    return NextResponse.json({ headers });
  } catch (error) {
    console.error("[Import Headers API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

