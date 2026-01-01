/**
 * Clear resolved verification items.
 * 
 * POST /api/signed/verification/clear
 * 
 * Removes all resolved items (resolved="TRUE") from the Verification sheet.
 * Does NOT delete Drive files, only clears the sheet rows.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";
import { SIGNED_VERIFICATION_SHEET_NAME } from "@/lib/workOrders/signedSheets";

export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || !user.userId || !user.googleAccessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get spreadsheet ID
    const spreadsheetId = await getUserSpreadsheetId(user.userId);
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not found" },
        { status: 400 }
      );
    }

    const sheets = createSheetsClient(user.googleAccessToken);
    const sheetName = SIGNED_VERIFICATION_SHEET_NAME;

    // Get all data to find resolved rows
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, `A:Z`), // Get all columns
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length <= 1) {
      // Only headers or empty
      return NextResponse.json({
        success: true,
        cleared: 0,
        message: "No items to clear",
      });
    }

    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => (h || "").toLowerCase().trim());
    const resolvedColIndex = headersLower.indexOf("resolved");

    if (resolvedColIndex === -1) {
      return NextResponse.json(
        { error: "Resolved column not found in Verification sheet" },
        { status: 400 }
      );
    }

    // Find all resolved rows (skip header row)
    const resolvedRowIndices: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[resolvedColIndex] && String(row[resolvedColIndex]).toUpperCase() === "TRUE") {
        resolvedRowIndices.push(i + 1); // +1 because Sheets is 1-indexed
      }
    }

    if (resolvedRowIndices.length === 0) {
      return NextResponse.json({
        success: true,
        cleared: 0,
        message: "No resolved items to clear",
      });
    }

    // Clear resolved rows by setting all cells to empty
    // Delete rows in reverse order to maintain indices
    const emptyRow = new Array(headers.length).fill("");
    let clearedCount = 0;

    for (let i = resolvedRowIndices.length - 1; i >= 0; i--) {
      const rowIndex = resolvedRowIndices[i];
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
          valueInputOption: "RAW",
          requestBody: {
            values: [emptyRow],
          },
        });
        clearedCount++;
      } catch (error) {
        console.error(`[Clear Verification] Error clearing row ${rowIndex}:`, error);
        // Continue with other rows
      }
    }

    console.log(`[Clear Verification] Cleared ${clearedCount} resolved item(s) from Verification sheet`);

    return NextResponse.json({
      success: true,
      cleared: clearedCount,
      message: `Cleared ${clearedCount} resolved item(s)`,
    });
  } catch (error) {
    console.error("[Clear Verification] Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

