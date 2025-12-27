/**
 * API route for getting template crop zone for an fmKey.
 * 
 * GET /api/onboarding/templates/get?fmKey=...
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById, ensureUsersSheet } from "@/lib/onboarding/usersSheet";
import { getTemplateByFmKey } from "@/lib/templates/templatesSheets";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google OAuth token not available. Please sign in again." },
        { status: 401 }
      );
    }

    // Get fmKey from query params
    const { searchParams } = new URL(request.url);
    const fmKey = searchParams.get("fmKey");

    if (!fmKey) {
      return NextResponse.json(
        { error: "fmKey query parameter is required" },
        { status: 400 }
      );
    }

    // Get the main spreadsheet ID from cookie (set during Google step)
    const cookieStore = await cookies();
    const mainSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    if (!mainSpreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not configured. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Ensure Users sheet exists (onboarding route - must ensure sheet exists)
    await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId, { allowEnsure: true });

    // Note: Templates are shared per spreadsheet, not per user, so we don't require a user row
    // The userId is stored for audit purposes but templates work without it

    // Get template
    const template = await getTemplateByFmKey(
      user.googleAccessToken,
      mainSpreadsheetId,
      user.userId,
      fmKey
    );

    if (!template) {
      return NextResponse.json({ template: null });
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Error getting template:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

