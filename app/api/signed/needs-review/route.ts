import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";
import { SIGNED_NEEDS_REVIEW_SHEET_NAME, SIGNED_NEEDS_REVIEW_COLUMNS } from "@/lib/workOrders/signedSheets";
import { getColumnRange } from "@/lib/google/sheetsCache";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Google access token not found." },
        { status: 400 }
      );
    }

    // Resolve spreadsheetId
    const cookieStore = await cookies();
    const cookieSpreadsheetId =
      cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      const session = await auth();
      const sessionSpreadsheetId = session
        ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId
        : null;
      spreadsheetId = await getUserSpreadsheetId(
        user.userId,
        sessionSpreadsheetId
      );
    }

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "No Google Sheets spreadsheet configured." },
        { status: 400 }
      );
    }

    // Read Needs_Review_Signed sheet
    const sheets = createSheetsClient(accessToken);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(SIGNED_NEEDS_REVIEW_SHEET_NAME, getColumnRange(SIGNED_NEEDS_REVIEW_COLUMNS.length)),
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const headers = (rows[0] || []) as string[];
    const headersLower = headers.map((h) => (h || "").toLowerCase().trim());

    // Map rows to objects
    const items = rows.slice(1).map((row) => {
      const item: Record<string, string | null> = {};
      headersLower.forEach((header, idx) => {
        item[header] = row[idx] ? String(row[idx]).trim() : null;
      });
      return item;
    });

    // Filter to only unresolved items
    const unresolved = items.filter(
      (item) => (item.resolved || "").toUpperCase() !== "TRUE"
    );

    return NextResponse.json({ items: unresolved });
  } catch (error) {
    console.error("Error in GET /api/signed/needs-review", error);
    return NextResponse.json(
      { error: "Failed to fetch verification items." },
      { status: 500 }
    );
  }
}

