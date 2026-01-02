/**
 * Read-only external sheet reader.
 * 
 * NEVER writes to external sheets. Only reads headers and rows.
 */

import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";

/**
 * Read headers from external sheet (READ-ONLY).
 * 
 * @param accessToken Google OAuth access token
 * @param externalSpreadsheetId External spreadsheet ID (customer's sheet)
 * @param sheetName Sheet name in external spreadsheet
 * @returns Array of header names
 */
export async function readExternalHeaders(
  accessToken: string,
  externalSpreadsheetId: string,
  sheetName: string
): Promise<string[]> {
  const sheets = createSheetsClient(accessToken);
  
  // READ-ONLY: Only use spreadsheets.values.get, never write operations
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: externalSpreadsheetId,
    range: formatSheetRange(sheetName, "1:1"), // Header row only
  });

  const headers = (response.data.values?.[0] || []) as string[];
  return headers.map(h => String(h || "").trim());
}

/**
 * Read rows from external sheet (READ-ONLY).
 * 
 * @param accessToken Google OAuth access token
 * @param externalSpreadsheetId External spreadsheet ID (customer's sheet)
 * @param sheetName Sheet name in external spreadsheet
 * @param limit Optional limit on number of rows to read (for preview)
 * @returns Array of row arrays (each row is an array of cell values)
 */
export async function readExternalRows(
  accessToken: string,
  externalSpreadsheetId: string,
  sheetName: string,
  limit?: number
): Promise<{ headers: string[]; rows: string[][] }> {
  const sheets = createSheetsClient(accessToken);
  
  // Determine range: if limit specified, read only that many rows
  const range = limit 
    ? formatSheetRange(sheetName, `A2:Z${limit + 1}`) // +1 because row 1 is headers
    : formatSheetRange(sheetName, "A2:Z"); // All rows after header
  
  // READ-ONLY: Only use spreadsheets.values.get, never write operations
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: externalSpreadsheetId,
    range,
  });

  // Get headers separately
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: externalSpreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const rows = (response.data.values || []) as string[][];

  return {
    headers: headers.map(h => String(h || "").trim()),
    rows: rows.map(row => row.map(cell => String(cell || "").trim())),
  };
}

