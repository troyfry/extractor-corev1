/**
 * API route for managing user's Google Sheets spreadsheet ID.
 * 
 * GET /api/user-settings/spreadsheet-id
 *   Response: { googleSheetsSpreadsheetId: string | null }
 * 
 * POST /api/user-settings/spreadsheet-id
 *   Body: { spreadsheetId: string | null }
 *   Response: { success: true, googleSheetsSpreadsheetId: string | null, validated: boolean }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { saveUserSpreadsheetId, getUserSettings } from "@/lib/userSettings/repository";
import { ensureColumnsExist } from "@/lib/google/sheets";
import { auth } from "@/auth";

/**
 * Extract spreadsheet ID from a Google Sheets URL.
 * Handles both full URLs and just the ID.
 * 
 * Examples:
 * - https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit -> SPREADSHEET_ID
 * - SPREADSHEET_ID -> SPREADSHEET_ID
 */
function extractSpreadsheetId(input: string): string | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // If it looks like a URL, extract the ID
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // If it's just an ID (alphanumeric, dashes, underscores), return as-is
  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * GET /api/user-settings/spreadsheet-id
 * Get the current user's Google Sheets spreadsheet ID.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check cookie first (session-based, no DB storage)
    const { cookies } = await import("next/headers");
    const cookieSpreadsheetId = (await cookies()).get("googleSheetsSpreadsheetId")?.value || null;
    
    if (cookieSpreadsheetId) {
      return NextResponse.json({ googleSheetsSpreadsheetId: cookieSpreadsheetId });
    }

    // Check session/JWT token (preferred - no DB storage)
    const session = await auth();
    const sessionSpreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId : null;
    
    if (sessionSpreadsheetId) {
      return NextResponse.json({ googleSheetsSpreadsheetId: sessionSpreadsheetId });
    }

    // Fallback to database
    const settings = await getUserSettings(user.userId);
    const spreadsheetId = settings?.googleSheetsSpreadsheetId || null;

    return NextResponse.json({ googleSheetsSpreadsheetId: spreadsheetId });
  } catch (error) {
    console.error("Error getting spreadsheet ID:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user-settings/spreadsheet-id
 * Save or update the user's Google Sheets spreadsheet ID.
 * Validates access by calling ensureColumnsExist().
 */
export async function POST(request: Request) {
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

    const body = await request.json();
    const { spreadsheetId: rawSpreadsheetId } = body;

    // Extract spreadsheet ID from URL if needed
    const spreadsheetId = rawSpreadsheetId
      ? extractSpreadsheetId(rawSpreadsheetId)
      : null;

    // Validate access if spreadsheet ID is provided
    let validated = false;
    if (spreadsheetId) {
      try {
        await ensureColumnsExist(
          user.googleAccessToken,
          spreadsheetId,
          "Sheet1"
        );
        validated = true;
      } catch (validationError) {
        console.error("Error validating spreadsheet access:", validationError);
        return NextResponse.json(
          {
            error:
              "Cannot access this sheet. Please check that:\n" +
              "1. The spreadsheet ID is correct\n" +
              "2. The spreadsheet is shared with your Google account\n" +
              "3. You have edit access to the spreadsheet",
            validated: false,
          },
          { status: 400 }
        );
      }
    }

    // Save the spreadsheet ID to session (JWT token) - no database storage by default
    // This keeps user data out of the database
    // Note: saveUserSpreadsheetId with storeInDatabase: false just returns the value
    await saveUserSpreadsheetId(user.userId, spreadsheetId, { storeInDatabase: false });
    
    // Store in a secure HTTP-only cookie for session persistence
    // The cookie will be read by API routes to get the spreadsheet ID
    const response = NextResponse.json({
      success: true,
      googleSheetsSpreadsheetId: spreadsheetId,
      validated,
      storedIn: "session", // Indicates it's stored in session cookie, not DB
    });
    
    // Set cookie with spreadsheet ID (HTTP-only, secure, sameSite)
    if (spreadsheetId) {
      response.cookies.set("googleSheetsSpreadsheetId", spreadsheetId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60, // 30 days (matches session maxAge)
      });
      console.log(`[Settings] Saved spreadsheet ID to cookie: ${spreadsheetId.substring(0, 10)}...`);
    } else {
      // Clear cookie if spreadsheet ID is null
      response.cookies.delete("googleSheetsSpreadsheetId");
      console.log(`[Settings] Cleared spreadsheet ID cookie`);
    }
    
    return response;
  } catch (error) {
    console.error("Error saving spreadsheet ID:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

