/**
 * Google Sheets API client for job record management.
 * 
 * Google Sheets is the source of truth for job records.
 * Each row represents a job with a stable jobId (UUID) that never changes.
 */

import { google } from "googleapis";

/**
 * Required columns for job records in Google Sheets.
 * These columns will be created if missing.
 */
export const REQUIRED_COLUMNS = [
  "jobId",
  "issuer",
  "wo_number",
  "fmKey",
  "status",
  "original_pdf_url",
  "signed_pdf_url",
  "signed_preview_image_url",
  "signature_confidence",
  "created_at",
  "signed_at",
] as const;

export type JobRecord = {
  jobId: string; // Deterministic: normalize(issuer) + ":" + normalize(wo_number)
  issuer: string | null;
  wo_number: string;
  fmKey: string | null; // FM Profile key if matched, null otherwise
  status: string;
  original_pdf_url: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
  signature_confidence: string | null; // "high" | "medium" | "low" as text
  created_at: string; // ISO string
  signed_at: string | null; // ISO string or null
};

/**
 * Create a Google Sheets API client using an OAuth access token.
 */
export function createSheetsClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
}

/**
 * Ensure required columns exist in the Google Sheet.
 * Creates them in the first row if missing.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet (default: "Sheet1")
 */
/**
 * Format sheet name for Google Sheets API range.
 * Sheet names with spaces or special characters must be quoted.
 */
export function formatSheetRange(sheetName: string, range: string = "1:1"): string {
  // If sheet name contains spaces, quotes, or special characters, wrap it in single quotes
  if (/[\s'"]/.test(sheetName)) {
    return `'${sheetName.replace(/'/g, "''")}'!${range}`;
  }
  return `${sheetName}!${range}`;
}

export async function ensureColumnsExist(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string = "Sheet1"
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

  try {
    // Get the current header row
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "1:1"),
    });

    const existingHeaders = (headerResponse.data.values?.[0] || []) as string[];
    const existingHeadersLower = existingHeaders.map((h) => h.toLowerCase().trim());

    // Find missing columns
    const missingColumns: string[] = [];
    for (const col of REQUIRED_COLUMNS) {
      if (!existingHeadersLower.includes(col.toLowerCase())) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length === 0) {
      // All columns exist
      return;
    }

    // Add missing columns to the header row
    const updatedHeaders = [...existingHeaders, ...missingColumns];

    // Update the header row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: formatSheetRange(sheetName, "1:1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [updatedHeaders],
      },
    });

    console.log(`[Sheets] Added missing columns: ${missingColumns.join(", ")}`);
  } catch (error) {
    console.error("[Sheets] Error ensuring columns exist:", error);
    throw error;
  }
}

/**
 * Get the column index for a given column name.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet (default: "Sheet1")
 * @param columnName Column name to find
 * @returns Column index (0-based) or -1 if not found
 */
async function getColumnIndex(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  columnName: string
): Promise<number> {
  const sheets = createSheetsClient(accessToken);

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const index = headers.findIndex(
    (h) => h.toLowerCase().trim() === columnName.toLowerCase()
  );

  return index;
}

/**
 * Write a job record to Google Sheets.
 * Creates the row if it doesn't exist, or updates it if it does (by jobId).
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet (default: "Sheet1")
 * @param record Job record to write
 */
export async function writeJobRecord(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  record: JobRecord
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

  // Ensure columns exist
  await ensureColumnsExist(accessToken, spreadsheetId, sheetName);

  try {
    // Get all data to find existing row by jobId
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "A:Z"),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      // No data, just append
      await appendJobRecord(accessToken, spreadsheetId, sheetName, record);
      return;
    }

    // Find row index by jobId (jobId is in first column)
    const headers = rows[0] as string[];
    const jobIdColIndex = headers.findIndex(
      (h) => h.toLowerCase().trim() === "jobid"
    );

    if (jobIdColIndex === -1) {
      // jobId column not found, just append
      await appendJobRecord(accessToken, spreadsheetId, sheetName, record);
      return;
    }

    // Find existing row by jobId
    let existingRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[jobIdColIndex] === record.jobId) {
        existingRowIndex = i + 1; // +1 because Sheets is 1-indexed
        break;
      }
    }

    if (existingRowIndex === -1) {
      // Row doesn't exist, append it
      await appendJobRecord(accessToken, spreadsheetId, sheetName, record);
    } else {
      // Row exists, update it
      await updateJobRecord(
        accessToken,
        spreadsheetId,
        sheetName,
        existingRowIndex,
        record
      );
    }
  } catch (error) {
    console.error("[Sheets] Error writing job record:", error);
    throw error;
  }
}

/**
 * Append a new job record to Google Sheets.
 */
async function appendJobRecord(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  record: JobRecord
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

  // Get headers to determine column order
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  // Build row data in the correct column order - pad to match header length
  const rowData: string[] = new Array(headers.length).fill("");
  
  for (const col of REQUIRED_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1) {
      // Column exists, get value from record
      const value = record[col as keyof JobRecord];
      rowData[index] = value === null || value === undefined ? "" : String(value);
    }
  }

  console.log(`[Sheets] Appending row with ${rowData.length} columns, headers: ${headers.length}`);

  // Append row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, "A:Z"),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Sheets] Appended job record: ${record.jobId}`);
}

/**
 * Update an existing job record in Google Sheets.
 */
async function updateJobRecord(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  record: JobRecord
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

  // Get headers to determine column order
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  // Build row data in the correct column order - pad to match header length
  const rowData: string[] = new Array(headers.length).fill("");
  
  for (const col of REQUIRED_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1) {
      // Column exists, get value from record
      const value = record[col as keyof JobRecord];
      rowData[index] = value === null || value === undefined ? "" : String(value);
    }
  }

  console.log(`[Sheets] Updating row ${rowIndex} with ${rowData.length} columns`);

  // Update row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Sheets] Updated job record: ${record.jobId}`);
}

/**
 * Find a job record by jobId.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet (default: "Sheet1")
 * @param jobId Job ID to find
 * @returns Job record if found, null otherwise
 */
export async function findJobRecordByJobId(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  jobId: string
): Promise<JobRecord | null> {
  const sheets = createSheetsClient(accessToken);

  try {
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "A:Z"),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return null;
    }

    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => h.toLowerCase().trim());

    // Find jobId column index
    const jobIdColIndex = headersLower.indexOf("jobid");
    if (jobIdColIndex === -1) {
      return null;
    }

    // Find row with matching jobId
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[jobIdColIndex] === jobId) {
        // Build record from row
        const record: Partial<JobRecord> = {};
        for (const col of REQUIRED_COLUMNS) {
          const colIndex = headersLower.indexOf(col.toLowerCase());
          if (colIndex !== -1 && row[colIndex] !== undefined) {
            const value = row[colIndex];
            (record as any)[col] = value === "" ? null : value;
          }
        }
        return record as JobRecord;
      }
    }

    return null;
  } catch (error) {
    console.error("[Sheets] Error finding job record:", error);
    throw error;
  }
}

/**
 * Update an existing job row by wo_number with signed work order info.
 * Returns true if a matching row was found and updated, false otherwise.
 */
export async function updateJobWithSignedInfoByWorkOrderNumber(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  woNumber: string,
  signedData: {
    signedPdfUrl: string;
    signedPreviewImageUrl: string | null;
    confidence: "high" | "medium" | "low";
    signedAt?: string;
    statusOverride?: string;
    fmKey?: string | null;
  }
): Promise<boolean> {
  const sheets = createSheetsClient(accessToken);

  // Ensure all required columns (including new signed columns) exist
  await ensureColumnsExist(accessToken, spreadsheetId, sheetName);

  const allDataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "A:Z"),
  });

  const rows = allDataResponse.data.values || [];
  if (rows.length === 0) {
    console.warn("[Sheets] No rows found when trying to update signed info.");
    return false;
  }

  const headers = rows[0] as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  const woColIndex = headersLower.indexOf("wo_number");
  if (woColIndex === -1) {
    console.warn(
      `[Sheets] wo_number column not found in sheet ${sheetName} when updating signed info.`
    );
    return false;
  }

  const normalizedTarget = (woNumber || "").trim();
  let rowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cellValue = (row?.[woColIndex] || "").trim();
    if (cellValue && cellValue === normalizedTarget) {
      rowIndex = i + 1; // Sheets rows are 1-based
      break;
    }
  }

  if (rowIndex === -1) {
    console.warn(
      `[Sheets] No row found with wo_number="${normalizedTarget}" in sheet ${sheetName}.`
    );
    return false;
  }

  const getIndex = (name: string) =>
    headersLower.indexOf(name.toLowerCase());

  const signedPdfCol = getIndex("signed_pdf_url");
  const signedPreviewCol = getIndex("signed_preview_image_url");
  const confidenceCol = getIndex("signature_confidence");
  const signedAtCol = getIndex("signed_at");
  const statusCol = getIndex("status");
  const fmKeyCol = getIndex("fmkey");
  const issuerCol = getIndex("issuer");

  const existingRow = rows[rowIndex - 1] || [];
  const rowData = [...existingRow];

  const setCell = (colIndex: number, value: string | null) => {
    if (colIndex < 0) return;
    while (rowData.length <= colIndex) {
      rowData.push("");
    }
    rowData[colIndex] = value ?? "";
  };

  const signedAt =
    signedData.signedAt && signedData.signedAt.trim().length > 0
      ? signedData.signedAt
      : new Date().toISOString();

  setCell(signedPdfCol, signedData.signedPdfUrl);
  setCell(signedPreviewCol, signedData.signedPreviewImageUrl);
  setCell(confidenceCol, signedData.confidence);
  setCell(signedAtCol, signedAt);
  setCell(statusCol, signedData.statusOverride || "SIGNED");
  
  // Update fmKey/issuer if provided (ensures correct fmKey is set for signed work orders)
  if (signedData.fmKey !== undefined) {
    setCell(fmKeyCol, signedData.fmKey);
    // Also update issuer if fmKey is provided (issuer often matches fmKey)
    if (issuerCol >= 0 && signedData.fmKey) {
      setCell(issuerCol, signedData.fmKey);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(
    `[Sheets] Updated signed info for wo_number="${normalizedTarget}" in sheet ${sheetName}`
  );

  return true;
}

