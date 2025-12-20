import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";

export const SIGNED_NEEDS_REVIEW_SHEET_NAME = "Needs_Review_Signed" as const;

export const SIGNED_NEEDS_REVIEW_COLUMNS = [
  "fmKey",
  "signed_pdf_url",
  "preview_image_url",
  "raw_text",
  "confidence",
  "reason",
  "manual_work_order_number",
  "resolved",
  "resolved_at",
] as const;

export type SignedNeedsReviewRecord = {
  fmKey: string | null;
  signed_pdf_url: string | null;
  preview_image_url: string | null;
  raw_text: string | null;
  confidence: "high" | "medium" | "low" | "unknown" | null;
  reason: string | null;
  manual_work_order_number: string | null;
  resolved: string | null;
  resolved_at: string | null;
};

/**
 * Ensure the Needs_Review_Signed sheet exists and has all required columns.
 * If columns are missing from the header row, they are appended.
 */
export async function ensureSignedNeedsReviewColumnsExist(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;

  // Get current header row
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const existingHeaders = (headerResponse.data.values?.[0] || []) as string[];
  const existingLower = existingHeaders.map((h) => h.toLowerCase().trim());

  const missing: string[] = [];
  for (const col of SIGNED_NEEDS_REVIEW_COLUMNS) {
    if (!existingLower.includes(col.toLowerCase())) {
      missing.push(col);
    }
  }

  if (missing.length === 0) {
    return;
  }

  const updatedHeaders = [...existingHeaders, ...missing];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
    valueInputOption: "RAW",
    requestBody: {
      values: [updatedHeaders],
    },
  });

  console.log(
    `[Sheets] Added missing columns on ${sheetName}: ${missing.join(", ")}`
  );
}

/**
 * Append a row to the Needs_Review_Signed sheet.
 */
export async function appendSignedNeedsReviewRow(
  accessToken: string,
  spreadsheetId: string,
  record: SignedNeedsReviewRecord
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;

  // Make sure headers/columns exist first
  await ensureSignedNeedsReviewColumnsExist(accessToken, spreadsheetId);

  // Fetch headers to align fields to columns
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  const rowData = new Array(headers.length).fill("");

  const toMap: Record<string, string | null> = {
    fmKey: record.fmKey,
    signed_pdf_url: record.signed_pdf_url,
    preview_image_url: record.preview_image_url,
    raw_text: record.raw_text,
    confidence: record.confidence,
    reason: record.reason,
    manual_work_order_number: record.manual_work_order_number,
    resolved: record.resolved,
    resolved_at: record.resolved_at,
  };

  for (const [key, value] of Object.entries(toMap)) {
    const idx = headersLower.indexOf(key.toLowerCase());
    if (idx === -1) {
      console.warn(`[Signed Sheets] Column "${key}" not found in headers:`, headers);
      continue;
    }
    // Ensure value is always a string (handle null/undefined)
    rowData[idx] = value != null ? String(value) : "";
  }

  console.log("[Signed Sheets] Row data being appended:", {
    fmKey: record.fmKey,
    raw_text_length: record.raw_text?.length || 0,
    raw_text_preview: record.raw_text?.substring(0, 50) || "",
    has_raw_text: !!record.raw_text,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, "A:Z"),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log("[Sheets] Appended Needs_Review_Signed row");
}

