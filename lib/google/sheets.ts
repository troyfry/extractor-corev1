/**
 * Google Sheets API client for job record management.
 * 
 * Google Sheets is the source of truth for job records.
 * Each row represents a job with a stable jobId (UUID) that never changes.
 * 
 * Sheet Structure:
 * - Sheet1: Job process tracking (status, PDFs, signatures, workflow state)
 * - Work_Orders: Detailed work order information (dates, addresses, costs, job details)
 * - Verification: Failed email PDF extractions
 * - Verification: Signed work orders that need review
 */

import { google } from "googleapis";
import {
  getHeaderCacheKey,
  getCachedHeaders,
  setCachedHeaders,
  getEnsuredKey,
  isEnsured,
  markEnsured,
  columnIndexToLetter,
  getColumnRange,
} from "@/lib/google/sheetsCache";

/**
 * Required columns for job records in Sheet1.
 * 
 * Purpose: Track job processes, workflow status, and document links.
 * Focus: Process tracking (status, PDFs, signatures, confidence).
 * 
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
  "manually_overridden", // Add this to track manual overrides
  "override_at", // Add this to track when override happened
] as const;

/**
 * Required columns for work order records in the Work_Orders sheet.
 * 
 * Purpose: Store detailed work order information for business operations.
 * Focus: Work order details (scheduled dates, job sites, costs, customer info).
 * 
 * This is separate from Sheet1 (job process tracking) to maintain a clean
 * separation between workflow status and work order data.
 * 
 * These columns will be created if missing.
 */
export const WORK_ORDER_REQUIRED_COLUMNS = [
  "jobId",
  "fmKey",
  "wo_number",
  "status",
  "scheduled_date",
  "created_at",
  "timestamp_extracted",
  "customer_name",
  "vendor_name",
  "service_address",
  "job_type",
  "job_description",
  "amount",
  "currency",
  "notes",
  "priority",
  "calendar_event_link",
  "work_order_pdf_link",
  "signed_pdf_url",
  "signed_preview_image_url",
  "source",
  "last_updated_at",
  "file_hash",
  // Phase 3: Decision metadata
  "signed_decision_state",
  "signed_trust_score",
  "signed_decision_reasons",
  "signed_extraction_method",
  "signed_ocr_confidence_raw",
  "signed_pass_agreement",
  "signed_candidates",
  // Phase 3: Verified by human
  "wo_verified",
  "wo_verified_at",
  "wo_verified_value",
] as const;

/**
 * Job record for Sheet1 - tracks job processes and workflow status.
 * 
 * Purpose: Process tracking, document management, signature workflow.
 * Contains: Status, PDF links, signature info, timestamps.
 * Does NOT contain: Detailed work order data (dates, addresses, costs).
 */
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
 * Work order record for Work_Orders sheet - detailed work order information.
 * 
 * Purpose: Business operations data (scheduling, billing, job details).
 * Contains: Scheduled dates, job sites (service_address), costs (amount/currency),
 *           customer info, job descriptions, priorities, notes.
 * 
 * This is separate from Sheet1 (job process tracking) to maintain clean separation
 * between workflow status and operational work order data.
 */
export type WorkOrderRecord = {
  jobId: string;
  fmKey: string | null;
  wo_number: string;
  status: string;
  scheduled_date: string | null; // Job site visit date
  created_at: string; // when WO first entered the system
  timestamp_extracted: string; // timestamp of the latest extraction run
  customer_name: string | null;
  vendor_name: string | null;
  service_address: string | null; // Job site address
  job_type: string | null;
  job_description: string | null;
  amount: string | null; // Cost/price
  currency: string | null;
  notes: string | null;
  priority: string | null;
  calendar_event_link: string | null;
  work_order_pdf_link: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
  signed_at: string | null; // ISO string or null
  source: string | null; // email, manual_upload, api, etc.
  last_updated_at: string; // ISO string
  file_hash?: string | null; // Hash of the PDF file for deduplication
  file_hash_created_at?: string | null; // Timestamp when file_hash was computed
  // Phase 3: Decision metadata
  signed_decision_state?: "AUTO_CONFIRMED" | "QUICK_CHECK" | "NEEDS_ATTENTION" | null;
  signed_trust_score?: number | null;
  signed_decision_reasons?: string | null; // Pipe-separated
  signed_extraction_method?: "DIGITAL_TEXT" | "OCR" | null;
  signed_ocr_confidence_raw?: number | null; // 0..1
  signed_pass_agreement?: "TRUE" | "FALSE" | null;
  signed_candidates?: string | null; // Pipe-separated
  // Phase 3: Verified by human
  wo_verified?: "TRUE" | "FALSE" | null;
  wo_verified_at?: string | null; // ISO string
  wo_verified_value?: string | null;
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

/**
 * Generic helper to ensure required columns exist in a Google Sheet.
 * Creates them in the first row if missing.
 */
async function ensureColumnsExistWithColumns(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  requiredColumns: readonly string[]
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

    // Get the current header row
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "1:1"),
    });

    const existingHeaders = (headerResponse.data.values?.[0] || []) as string[];
    const existingHeadersLower = existingHeaders.map((h) => h.toLowerCase().trim());

    const missingColumns: string[] = [];
  for (const col of requiredColumns) {
      if (!existingHeadersLower.includes(col.toLowerCase())) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length === 0) {
      return;
    }

    const updatedHeaders = [...existingHeaders, ...missingColumns];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: formatSheetRange(sheetName, "1:1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [updatedHeaders],
      },
    });

  console.log(
    `[Sheets] Added missing columns to '${sheetName}': ${missingColumns.join(", ")}`
  );
}

/**
 * Ensure required columns exist in the Google Sheet.
 * Creates them in the first row if missing.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet (default: "Sheet1")
 */
export async function ensureColumnsExist(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string = "Sheet1"
): Promise<void> {
  await ensureColumnsExistWithColumns(
    accessToken,
    spreadsheetId,
    sheetName,
    REQUIRED_COLUMNS
  );
}

/**
 * Ensure the Work_Orders sheet exists. Creates it if it doesn't exist.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet
 */
async function ensureWorkOrderSheetExists(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

  console.log(`[ensureWorkOrderSheetExists] Checking if sheet "${sheetName}" exists`);

  try {
    // Get spreadsheet metadata to check if sheet exists
    const spreadsheetResponse = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const allSheetNames = spreadsheetResponse.data.sheets?.map(s => s.properties?.title).filter(Boolean) || [];
    console.log(`[ensureWorkOrderSheetExists] Existing sheets: ${allSheetNames.join(", ")}`);

    const sheetExists = spreadsheetResponse.data.sheets?.some(
      (sheet) => sheet.properties?.title === sheetName
    );

    console.log(`[ensureWorkOrderSheetExists] Sheet "${sheetName}" exists: ${sheetExists}`);

    // Create sheet if it doesn't exist
    if (!sheetExists) {
      console.log(`[ensureWorkOrderSheetExists] Creating "${sheetName}" sheet`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });
      console.log(`[ensureWorkOrderSheetExists] ✅ Successfully created "${sheetName}" sheet`);
    } else {
      console.log(`[ensureWorkOrderSheetExists] Sheet "${sheetName}" already exists`);
    }
  } catch (error) {
    // If we can't check/create the sheet, log but continue
    // The column ensure will fail with a clearer error if the sheet truly doesn't exist
    console.error(`[ensureWorkOrderSheetExists] ❌ ERROR: Could not ensure "${sheetName}" sheet exists:`, {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      sheetName,
      spreadsheetId: `${spreadsheetId.substring(0, 10)}...`,
    });
    throw error; // Re-throw so we know if sheet creation fails
  }
}

/**
 * Ensure required work order columns exist in the Google Sheet.
 * Creates the sheet if it doesn't exist, and creates columns in the first row if missing.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet
 */
export async function ensureWorkOrderColumnsExist(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  // First ensure the sheet exists
  await ensureWorkOrderSheetExists(accessToken, spreadsheetId, sheetName);
  
  // Then ensure columns exist
  await ensureColumnsExistWithColumns(
    accessToken,
    spreadsheetId,
    sheetName,
    WORK_ORDER_REQUIRED_COLUMNS
  );
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
      range: formatSheetRange(sheetName, getColumnRange(REQUIRED_COLUMNS.length)),
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
  const valueMap: Record<string, string> = {};
  
  for (const col of REQUIRED_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1) {
      // Column exists, get value from record
      const value = record[col as keyof JobRecord];
      const stringValue = value === null || value === undefined ? "" : String(value);
      rowData[index] = stringValue;
      valueMap[col] = stringValue;
    } else {
      console.warn(`[appendJobRecord] Column "${col}" not found in headers`);
    }
  }

  console.log(`[appendJobRecord] Appending row to ${sheetName}:`, {
    jobId: record.jobId,
    fmKey: valueMap.fmKey,
    wo_number: valueMap.wo_number,
    issuer: valueMap.issuer,
    rowDataLength: rowData.length,
    headersLength: headers.length,
  });

  // Append row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, getColumnRange(REQUIRED_COLUMNS.length)),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[appendJobRecord] ✅ Appended job record: ${record.jobId} (fmKey: ${valueMap.fmKey})`);
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
  const valueMap: Record<string, string> = {};
  
  for (const col of REQUIRED_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1) {
      // Column exists, get value from record
      const value = record[col as keyof JobRecord];
      const stringValue = value === null || value === undefined ? "" : String(value);
      rowData[index] = stringValue;
      valueMap[col] = stringValue;
    } else {
      console.warn(`[updateJobRecord] Column "${col}" not found in headers`);
    }
  }

  console.log(`[updateJobRecord] Updating row ${rowIndex} in ${sheetName}:`, {
    jobId: record.jobId,
    fmKey: valueMap.fmKey,
    wo_number: valueMap.wo_number,
    issuer: valueMap.issuer,
    rowDataLength: rowData.length,
  });

  // Update row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[updateJobRecord] ✅ Updated job record: ${record.jobId} (fmKey: ${valueMap.fmKey})`);
}

/**
 * Find a job record by jobId.
 * Optimized to read only the jobId column first, then read just the matching row.
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
    // Get headers (cached)
    const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, sheetName);
    
    // Find row index by reading only the jobId column (much more efficient)
    const jobIdLetter = headerMeta.colLetterByLower["jobid"];
    if (!jobIdLetter) {
      return null;
    }

    const rowIndex = await findRowIndexByColumnValue(
      accessToken,
      spreadsheetId,
      sheetName,
      jobIdLetter,
      jobId
    );

    if (rowIndex === -1) {
      return null;
    }

    // Read only the specific row (not the entire sheet)
    const rowResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    });

    const rowData = (rowResponse.data.values?.[0] || []) as string[];
    if (!rowData || rowData.length === 0) {
      return null;
    }

    // Build record from row data
    const record: Partial<JobRecord> = {};
    const headersLower = headerMeta.headersLower;

    for (const col of REQUIRED_COLUMNS) {
      const colIndex = headerMeta.colIndexByLower[col.toLowerCase()];
      if (colIndex !== undefined && colIndex >= 0 && rowData[colIndex] !== undefined) {
        const value = rowData[colIndex];
        (record as Record<string, unknown>)[col] = value === "" ? null : value;
      }
    }

    return record as JobRecord;
  } catch (error) {
    // Handle quota errors gracefully - don't throw, just log and return null
    if (error && typeof error === "object" && "code" in error && error.code === 429) {
      console.warn("[Sheets] Quota exceeded when finding job record, returning null:", {
        jobId,
        sheetName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    console.error("[Sheets] Error finding job record:", error);
    throw error;
  }
}

/**
 * Find a work order record by jobId.
 * Optimized to read only the jobId column first, then read just the matching row.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet
 * @param jobId Job ID to find
 * @returns Work order record if found, null otherwise
 */
export async function findWorkOrderRecordByJobId(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  jobId: string
): Promise<WorkOrderRecord | null> {
  const sheets = createSheetsClient(accessToken);

  try {
    // Get headers (cached)
    const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, sheetName);
    
    // Find row index by reading only the jobId column (much more efficient)
    const jobIdLetter = headerMeta.colLetterByLower["jobid"];
    if (!jobIdLetter) {
      return null;
    }

    const rowIndex = await findRowIndexByColumnValue(
      accessToken,
      spreadsheetId,
      sheetName,
      jobIdLetter,
      jobId
    );

    if (rowIndex === -1) {
      return null;
    }

    // Read only the specific row (not the entire sheet)
    const rowResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    });

    const rowData = (rowResponse.data.values?.[0] || []) as string[];
    if (!rowData || rowData.length === 0) {
      return null;
    }

    // Build record from row data
    const record: Partial<WorkOrderRecord> = {};
    const headersLower = headerMeta.headersLower;

    for (const col of WORK_ORDER_REQUIRED_COLUMNS) {
      const colIndex = headerMeta.colIndexByLower[col.toLowerCase()];
      if (colIndex !== undefined && colIndex >= 0 && rowData[colIndex] !== undefined) {
        const value = rowData[colIndex];
        (record as Record<string, unknown>)[col] = value === "" ? null : value;
      }
    }

    return record as WorkOrderRecord;
  } catch (error) {
    // Handle quota errors gracefully - don't throw, just log and return null
    if (error && typeof error === "object" && "code" in error && error.code === 429) {
      console.warn("[Sheets] Quota exceeded when finding work order record, returning null:", {
        jobId,
        sheetName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    console.error("[Sheets] Error finding work order record:", error);
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
    manuallyOverridden?: boolean; // Add this parameter
  }
): Promise<boolean> {
  const sheets = createSheetsClient(accessToken);

  // Ensure all required columns (including new signed columns) exist
  // Gate with cache to avoid running on every request
  const ensuredKey = getEnsuredKey(spreadsheetId, sheetName);
  if (!isEnsured(ensuredKey)) {
    await ensureColumnsExist(accessToken, spreadsheetId, sheetName);
    markEnsured(ensuredKey);
  }

  const allDataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, getColumnRange(REQUIRED_COLUMNS.length)),
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
  const manuallyOverriddenCol = getIndex("manually_overridden"); // Add this
  const overrideAtCol = getIndex("override_at"); // Add this

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
  
  // Update fmKey if provided (ensures correct fmKey is set for signed work orders)
  // DO NOT update issuer - issuer should remain as the original domain (e.g., "23rdgroup.com")
  if (signedData.fmKey !== undefined) {
    setCell(fmKeyCol, signedData.fmKey);
  }

  if (signedData.manuallyOverridden) {
    setCell(manuallyOverriddenCol, "TRUE");
    setCell(overrideAtCol, signedData.signedAt || new Date().toISOString());
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

/**
 * Check if a work order record has meaningful operational data.
 * Returns true if the record has at least one meaningful field beyond basic identifiers.
 */
function hasMeaningfulWorkOrderData(record: WorkOrderRecord): boolean {
  // Always allow records with SIGNED status - these are important updates even if other data is missing
  if (record.status === "SIGNED") {
    return true;
  }
  
  // Basic identifiers don't count as "meaningful operational data"
  // Meaningful fields are: customer_name, vendor_name, service_address, job_type, 
  // job_description, amount, currency, notes, priority, scheduled_date
  // Also include signed-related fields (signed_pdf_url, status, signed_at) as meaningful
  // since signed work orders should be written even if other operational data is missing
  const meaningfulFields = [
    record.customer_name,
    record.vendor_name,
    record.service_address,
    record.job_type,
    record.job_description,
    record.amount,
    record.currency,
    record.notes,
    record.priority,
    record.scheduled_date,
    record.work_order_pdf_link,
    // Signed-related fields are meaningful (for signed work orders)
    record.signed_pdf_url,
    record.signed_preview_image_url,
    record.signed_at,
    // Status is meaningful (especially non-OPEN statuses)
    record.status && record.status !== "OPEN" ? record.status : null,
  ];
  
  return meaningfulFields.some(field => field != null && String(field).trim() !== "");
}

/**
 * Append a new work order record to Google Sheets.
 * Only appends if the record has meaningful operational data to prevent empty rows.
 */
async function appendWorkOrderRecord(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  record: WorkOrderRecord
): Promise<void> {
  // Don't append records with mostly empty fields - only write if we have meaningful operational data
  if (!hasMeaningfulWorkOrderData(record)) {
    console.log(`[appendWorkOrderRecord] Skipping append - record has no meaningful operational data:`, {
      jobId: record.jobId,
      fmKey: record.fmKey,
      wo_number: record.wo_number,
      status: record.status,
    });
    return;
  }
  const sheets = createSheetsClient(accessToken);

  console.log(`[appendWorkOrderRecord] Appending new record to ${sheetName}`, {
    jobId: record.jobId,
    fmKey: record.fmKey,
    wo_number: record.wo_number,
  });

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());
  console.log(`[appendWorkOrderRecord] Headers: ${headers.join(", ")}`);

  const rowData: string[] = new Array(headers.length).fill("");
  const valueMap: Record<string, string> = {};
  
  for (const col of WORK_ORDER_REQUIRED_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1) {
      const value = record[col as keyof WorkOrderRecord];
      const stringValue = value === null || value === undefined ? "" : String(value);
      rowData[index] = stringValue;
      valueMap[col] = stringValue;
    } else {
      console.warn(`[appendWorkOrderRecord] Column "${col}" not found in headers`);
    }
  }

  console.log(`[appendWorkOrderRecord] Row data to append:`, {
    fmKey: valueMap.fmKey,
    wo_number: valueMap.wo_number,
    status: valueMap.status,
    rowDataLength: rowData.length,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, getColumnRange(WORK_ORDER_REQUIRED_COLUMNS.length)),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[appendWorkOrderRecord] ✅ Successfully appended record: ${record.jobId}`, {
    fmKey: valueMap.fmKey,
    wo_number: valueMap.wo_number,
  });
}

/**
 * Update an existing work order record in Google Sheets.
 */
async function updateWorkOrderRecord(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  record: WorkOrderRecord
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

  // Read existing row first to preserve data in columns not being updated
  const existingRowResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
  });

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());
  
  // Start with existing row data (preserve all existing values)
  const existingRow = (existingRowResponse.data.values?.[0] || []) as string[];
  const rowData: string[] = [...existingRow];
  
  // Ensure rowData has enough elements for all headers
  while (rowData.length < headers.length) {
    rowData.push("");
  }

  // Only update columns that are provided in the record (non-null/non-undefined)
  // This preserves existing data in columns we're not updating
  for (const col of WORK_ORDER_REQUIRED_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1) {
      const value = record[col as keyof WorkOrderRecord];
      // Only update if value is explicitly provided (not null/undefined)
      // This allows us to update specific fields without clearing others
      if (value !== null && value !== undefined) {
        rowData[index] = String(value);
      }
      // If value is null/undefined, keep existing value (don't overwrite with empty string)
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

  console.log(`[Sheets] Updated work order record: ${record.jobId}`);
}

/**
 * Update only specific columns in a work order record without overwriting other columns.
 * This is used for signed updates where we only want to update status and signed_at.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet
 * @param jobId Job ID to find the record
 * @param woNumber Work order number (fallback for finding record)
 * @param partialRecord Partial record with only the fields to update
 */
export async function updateWorkOrderRecordPartial(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  jobId: string,
  woNumber: string,
  partialRecord: Partial<WorkOrderRecord>
): Promise<void> {
  const sheets = createSheetsClient(accessToken);

  // Get headers to find column indices
  const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, sheetName);
  const headersLower = headerMeta.headersLower;

  // Find the row by jobId or wo_number
  let rowIndex = -1;
  const jobIdLetter = headerMeta.colLetterByLower["jobid"];
  if (jobIdLetter) {
    rowIndex = await findRowIndexByColumnValue(
      accessToken,
      spreadsheetId,
      sheetName,
      jobIdLetter,
      jobId
    );
  }
  
  // Fallback to wo_number if not found by jobId
  if (rowIndex === -1) {
    const woNumberLetter = headerMeta.colLetterByLower["wo_number"];
    if (woNumberLetter) {
      rowIndex = await findRowIndexByColumnValue(
        accessToken,
        spreadsheetId,
        sheetName,
        woNumberLetter,
        woNumber
      );
    }
  }

  if (rowIndex === -1) {
    console.warn(`[updateWorkOrderRecordPartial] Record not found for jobId: ${jobId}, wo_number: ${woNumber}`);
    return;
  }

  // Read existing row to preserve all other data
  const existingRowResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
  });

  const existingRow = (existingRowResponse.data.values?.[0] || []) as string[];
  const rowData: string[] = [...existingRow];
  
  // Ensure rowData has enough elements for all headers
  while (rowData.length < headersLower.length) {
    rowData.push("");
  }

  // Only update the specific fields provided in partialRecord
  const updates: Array<{ column: string; value: string }> = [];
  for (const [key, value] of Object.entries(partialRecord)) {
    if (value !== null && value !== undefined && key !== "jobId" && key !== "wo_number") {
      const index = headerMeta.colIndexByLower[key.toLowerCase()];
      if (index !== -1) {
        rowData[index] = String(value);
        updates.push({ column: key, value: String(value) });
      }
    }
  }

  if (updates.length === 0) {
    console.log(`[updateWorkOrderRecordPartial] No fields to update for jobId: ${jobId}`);
    return;
  }

  console.log(`[updateWorkOrderRecordPartial] Updating row ${rowIndex} with fields:`, updates.map(u => u.column).join(", "));

  // Update the row (preserving all existing data, only updating specified fields)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[updateWorkOrderRecordPartial] ✅ Updated work order record: ${jobId}`);
}

/**
 * Get sheet headers with caching to reduce API calls.
 */
export async function getSheetHeadersCached(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
) {
  const key = getHeaderCacheKey(spreadsheetId, sheetName);
  const cached = getCachedHeaders(key);

  // Cache TTL: 5 minutes
  if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
    return cached;
  }

  const sheets = createSheetsClient(accessToken);
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headerRow = (headerResp.data.values?.[0] || []) as string[];
  const headers = headerRow;
  const headersLower = headers.map((h) => (h || "").toLowerCase().trim());

  const colLetterByLower: Record<string, string> = {};
  const colIndexByLower: Record<string, number> = {};

  headersLower.forEach((h, idx) => {
    if (!h) return;
    colIndexByLower[h] = idx;
    colLetterByLower[h] = columnIndexToLetter(idx);
  });

  const value = {
    headers,
    headersLower,
    colLetterByLower,
    colIndexByLower,
    fetchedAt: Date.now(),
  };

  setCachedHeaders(key, value);
  return value;
}

/**
 * Find row index by column value (reads only one column, not entire sheet).
 * Includes retry logic with exponential backoff for quota errors.
 */
export async function findRowIndexByColumnValue(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  columnLetter: string,
  targetValue: string,
  retryCount: number = 0
): Promise<number> {
  const sheets = createSheetsClient(accessToken);
  const maxRetries = 2;
  const baseDelay = 1000; // 1 second

  try {
    // Read only the column (e.g., C:C)
    const colResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, `${columnLetter}:${columnLetter}`),
    });

    const colValues = colResp.data.values || [];
    const normalizedTarget = (targetValue || "").trim();

    // values[0] is header; row index is 1-based
    for (let i = 1; i < colValues.length; i++) {
      const cell = (colValues[i]?.[0] || "").trim();
      if (cell === normalizedTarget) {
        return i + 1; // 1-based row index in Sheets
      }
    }

    return -1;
  } catch (error) {
    // Handle quota errors with retry
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 429 &&
      retryCount < maxRetries
    ) {
      const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
      console.warn(
        `[Sheets] Quota exceeded, retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return findRowIndexByColumnValue(
        accessToken,
        spreadsheetId,
        sheetName,
        columnLetter,
        targetValue,
        retryCount + 1
      );
    }
    
    // If quota error and max retries reached, return -1 (not found) instead of throwing
    if (error && typeof error === "object" && "code" in error && error.code === 429) {
      console.warn("[Sheets] Quota exceeded, max retries reached, returning -1");
      return -1;
    }
    
    throw error;
  }
}

/**
 * Write a work order record to Google Sheets.
 * Creates the row if it doesn't exist, or updates it if it does (by jobId).
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName Name of the sheet
 * @param record Work order record to write
 */
export async function writeWorkOrderRecord(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  record: WorkOrderRecord
): Promise<void> {
  console.log(`[writeWorkOrderRecord] START - Writing to ${sheetName}:`, {
    jobId: record.jobId,
    fmKey: record.fmKey,
    wo_number: record.wo_number,
    status: record.status,
    spreadsheetId: `${spreadsheetId.substring(0, 10)}...`,
  });

  const sheets = createSheetsClient(accessToken);

  try {
    // Ensure the Work_Orders sheet has all required columns
    // Gate with cache to avoid running on every request
    const ensuredKey = getEnsuredKey(spreadsheetId, sheetName);
    if (!isEnsured(ensuredKey)) {
      console.log(`[writeWorkOrderRecord] Ensuring columns exist for sheet: ${sheetName}`);
      await ensureWorkOrderColumnsExist(accessToken, spreadsheetId, sheetName);
      markEnsured(ensuredKey);
      console.log(`[writeWorkOrderRecord] Columns ensured for sheet: ${sheetName}`);
    }

    // 1) Get headers (cached)
    const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, sheetName);

    // 2) Locate jobId column
    const jobIdLetter = headerMeta.colLetterByLower["jobid"];
    if (!jobIdLetter) {
      // Fallback: append only if meaningful
      if (hasMeaningfulWorkOrderData(record)) {
        console.log(`[writeWorkOrderRecord] No jobId column found, appending new record with meaningful data`);
        await appendWorkOrderRecord(accessToken, spreadsheetId, sheetName, record);
        console.log(`[writeWorkOrderRecord] ✅ Appended new record (no jobId col): ${record.jobId}`);
      } else {
        console.log(`[writeWorkOrderRecord] Skipping append - no jobId column and record has no meaningful operational data`);
      }
      return;
    }

    // 3) Find existing row by reading ONLY jobId column
    let existingRowIndex = await findRowIndexByColumnValue(
      accessToken,
      spreadsheetId,
      sheetName,
      jobIdLetter,
      record.jobId
    );

    // If not found by jobId, try searching by wo_number as fallback
    // This handles cases where jobId format differs (e.g., "unknown:493605" vs "23rdgroup_com:493605")
    if (existingRowIndex === -1 && record.wo_number) {
      const woNumberLetter = headerMeta.colLetterByLower["wo_number"];
      if (woNumberLetter) {
        console.log(`[writeWorkOrderRecord] JobId "${record.jobId}" not found, trying to find by wo_number: ${record.wo_number}`);
        const woRowIndex = await findRowIndexByColumnValue(
          accessToken,
          spreadsheetId,
          sheetName,
          woNumberLetter,
          record.wo_number
        );
        
        if (woRowIndex !== -1) {
          // Found by wo_number - read the row to get the correct jobId
          const sheets = createSheetsClient(accessToken);
          const rowResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: formatSheetRange(sheetName, `${woRowIndex}:${woRowIndex}`),
          });
          
          const rowData = (rowResponse.data.values?.[0] || []) as string[];
          const existingJobIdColIndex = headerMeta.colIndexByLower["jobid"];
          
          if (existingJobIdColIndex >= 0 && rowData[existingJobIdColIndex]) {
            const existingJobId = String(rowData[existingJobIdColIndex]).trim();
            console.log(`[writeWorkOrderRecord] Found existing record by wo_number with jobId: ${existingJobId}, updating that record instead`);
            // Update the record's jobId to match the existing one
            record.jobId = existingJobId;
            existingRowIndex = woRowIndex;
          }
        }
      }
    }

    if (existingRowIndex === -1) {
      // No existing row found, append if meaningful
      if (hasMeaningfulWorkOrderData(record)) {
        console.log(`[writeWorkOrderRecord] No existing row found, appending new record with meaningful data`);
        await appendWorkOrderRecord(accessToken, spreadsheetId, sheetName, record);
        console.log(`[writeWorkOrderRecord] ✅ Appended new record: ${record.jobId}`);
      } else {
        console.log(`[writeWorkOrderRecord] Skipping append - record has no meaningful operational data (only identifiers):`, {
          jobId: record.jobId,
          fmKey: record.fmKey,
          wo_number: record.wo_number,
          status: record.status,
        });
      }
      return;
    }

    // 4) Update existing row
    console.log(`[writeWorkOrderRecord] Updating existing row ${existingRowIndex} with data:`, {
      jobId: record.jobId,
      fmKey: record.fmKey,
      wo_number: record.wo_number,
      status: record.status,
    });
    await updateWorkOrderRecord(
      accessToken,
      spreadsheetId,
      sheetName,
      existingRowIndex,
      record
    );
    console.log(`[writeWorkOrderRecord] ✅ Updated existing record: ${record.jobId}`);
  } catch (error) {
    console.error(`[writeWorkOrderRecord] ❌ ERROR writing work order record:`, {
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      jobId: record.jobId,
      fmKey: record.fmKey,
      sheetName,
      spreadsheetId: `${spreadsheetId.substring(0, 10)}...`,
    });
    throw error;
  }
}

/**
 * Find a Google Sheets spreadsheet by name.
 * Uses Drive API to search for files with matching name and MIME type.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetName Name of the spreadsheet to find
 * @returns Spreadsheet ID if found, null otherwise
 */
export async function findSpreadsheetByName(
  accessToken: string,
  spreadsheetName: string
): Promise<string | null> {
  const { createDriveClient } = await import("@/lib/google/drive");
  const drive = createDriveClient(accessToken);
  
  try {
    // Search for files with matching name and MIME type for Google Sheets
    const response = await drive.files.list({
      q: `name='${spreadsheetName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: "files(id, name)",
      pageSize: 10,
    });
    
    const files = response.data.files || [];
    
    // Return exact match if found
    const exactMatch = files.find(f => f.name === spreadsheetName);
    if (exactMatch?.id) {
      return exactMatch.id;
    }
    
    // Return first match if no exact match (case-insensitive fallback)
    if (files.length > 0 && files[0].id) {
      return files[0].id;
    }
    
    return null;
  } catch (error) {
    console.error("[Sheets] Error finding spreadsheet by name:", error);
    return null;
  }
}

