/**
 * API route for saving Google Sheets and Drive configuration during onboarding.
 * 
 * POST /api/onboarding/google
 * Body: { sheetId: string, driveFolderId?: string }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { upsertUserRow, resetApiCallCount, getApiCallCount } from "@/lib/onboarding/usersSheet";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export const runtime = "nodejs";

/**
 * Extract spreadsheet ID from a Google Sheets URL or return as-is if already an ID.
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

export async function POST(request: Request) {
  resetApiCallCount();
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
    const { sheetId: rawSheetId, driveFolderId } = body;

    if (!rawSheetId) {
      return NextResponse.json(
        { error: "sheetId is required" },
        { status: 400 }
      );
    }

    // Extract spreadsheet ID from URL if needed
    const sheetId = extractSpreadsheetId(rawSheetId);
    if (!sheetId) {
      return NextResponse.json(
        { error: "Invalid spreadsheet ID format. Please provide a valid Google Sheets ID or URL." },
        { status: 400 }
      );
    }

    // Validate that the spreadsheet exists and user has access
    try {
      const { createSheetsClient } = await import("@/lib/google/sheets");
      const sheets = createSheetsClient(user.googleAccessToken);
      
      // Try to access the spreadsheet to verify it exists and user has access
      await sheets.spreadsheets.get({
        spreadsheetId: sheetId,
      });
    } catch (validationError: unknown) {
      console.error("Error validating spreadsheet access:", validationError);
      
      // Provide helpful error messages based on the error type
      const errorCode = (validationError as { code?: number })?.code;
      const errorStatus = (validationError as { status?: number })?.status;
      if (errorCode === 404 || errorStatus === 404) {
        return NextResponse.json(
          {
            error: "Spreadsheet not found. Please check that:\n" +
              "1. The spreadsheet ID is correct\n" +
              "2. The spreadsheet exists and hasn't been deleted",
          },
          { status: 400 }
        );
      }
      
      if (errorCode === 403 || errorStatus === 403) {
        return NextResponse.json(
          {
            error: "Access denied. Please check that:\n" +
              "1. The spreadsheet is shared with your Google account\n" +
              "2. You have edit access to the spreadsheet\n" +
              "3. You're signed in with the correct Google account",
          },
          { status: 403 }
        );
      }
      
      // Generic error
      return NextResponse.json(
        {
          error: "Cannot access this spreadsheet. Please verify:\n" +
            "1. The spreadsheet ID is correct\n" +
            "2. The spreadsheet is shared with your Google account\n" +
            "3. You have edit access to the spreadsheet",
        },
        { status: 400 }
      );
    }

    // The provided sheetId is the main spreadsheet where Users sheet will be stored
    // Use this spreadsheet for storing the Users sheet
    const mainSpreadsheetId = sheetId;

    // Upsert user row with sheetId and driveFolderId
    // Note: sheetId in Users sheet refers to the spreadsheet for jobs (same as mainSpreadsheetId in this case)
    // mainSpreadsheetId is where the Users sheet itself is stored
    await upsertUserRow(user.googleAccessToken, mainSpreadsheetId, {
      userId: user.userId,
      email: user.email || "",
      sheetId: sheetId,
      mainSpreadsheetId: mainSpreadsheetId, // Store where Users sheet is located
      driveFolderId: driveFolderId || "",
      onboardingCompleted: "FALSE",
      openaiKeyEncrypted: "",
      createdAt: new Date().toISOString(),
    }, { allowEnsure: true });

    // Store spreadsheet ID in cookie for session persistence
    const cookieStore = await cookies();
    const response = NextResponse.json({ success: true });
    response.cookies.set("googleSheetsSpreadsheetId", mainSpreadsheetId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    // Also update session/JWT token with spreadsheet ID immediately
    // This ensures the spreadsheet ID persists across logins
    // The JWT callback will read from cookies on next request, but we can also trigger an update
    // Note: The cookie is the primary storage, and JWT callback reads from it

    const apiCalls = getApiCallCount();
    console.log(`[onboarding/google] Sheets API calls: ${apiCalls}`);
    return response;
  } catch (error) {
    console.error("Error saving Google settings:", error);
    
    // If it's already a validation error we handled, re-throw it
    if (error instanceof Error && error.message.includes("Spreadsheet") || 
        error instanceof Error && error.message.includes("Access denied") ||
        error instanceof Error && error.message.includes("Cannot access")) {
      throw error;
    }
    
    // For other errors, provide a generic message
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { 
        error: message.includes("Requested entity was not found") 
          ? "Spreadsheet not found. Please verify the spreadsheet ID is correct and the spreadsheet exists."
          : message 
      },
      { status: 500 }
    );
  }
}

