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
 * - Needs_Review_Signed: Signed work orders that couldn't be auto-matched
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
      range: formatSheetRange(sheetName, getColumnRange(REQUIRED_COLUMNS.length)),
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
            (record as Record<string, unknown>)[col] = value === "" ? null : value;
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
 * Find a work order record by jobId.
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
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(WORK_ORDER_REQUIRED_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return null;
    }

    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => h.toLowerCase().trim());

    const jobIdColIndex = headersLower.indexOf("jobid");
    if (jobIdColIndex === -1) {
      return null;
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[jobIdColIndex] === jobId) {
        const record: Partial<WorkOrderRecord> = {};

        for (const col of WORK_ORDER_REQUIRED_COLUMNS) {
          const colIndex = headersLower.indexOf(col.toLowerCase());
          if (colIndex !== -1 && row[colIndex] !== undefined) {
            const value = row[colIndex];
            (record as Record<string, unknown>)[col] = value === "" ? null : value;
          }
        }

        return record as WorkOrderRecord;
      }
    }

    return null;
  } catch (error) {
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
  // Basic identifiers don't count as "meaningful operational data"
  // Meaningful fields are: customer_name, vendor_name, service_address, job_type, 
  // job_description, amount, currency, notes, priority, scheduled_date
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

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  const rowData: string[] = new Array(headers.length).fill("");
  for (const col of WORK_ORDER_REQUIRED_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1) {
      const value = record[col as keyof WorkOrderRecord];
      rowData[index] = value === null || value === undefined ? "" : String(value);
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
 */
export async function findRowIndexByColumnValue(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  columnLetter: string,
  targetValue: string
): Promise<number> {
  const sheets = createSheetsClient(accessToken);

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
    const existingRowIndex = await findRowIndexByColumnValue(
      accessToken,
      spreadsheetId,
      sheetName,
      jobIdLetter,
      record.jobId
    );

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

