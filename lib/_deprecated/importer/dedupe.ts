/**
 * Deduplication logic for imported work orders.
 * 
 * Checks existing internal sheet by work_order_number to determine if a record is:
 * - new: doesn't exist
 * - duplicate: exact match
 * - conflict: exists but with different data
 */

import type { CanonicalWorkOrderRecord, DedupeResult } from "./types";
import { getSheetHeadersCached, findRowIndexByColumnValue } from "@/lib/google/sheets";

const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

/**
 * Check if a canonical record already exists in the internal sheet.
 * 
 * @param accessToken Google OAuth access token
 * @param internalSpreadsheetId Internal spreadsheet ID (our sheet)
 * @param record Canonical work order record to check
 * @returns Deduplication result
 */
export async function dedupeRecord(
  accessToken: string,
  internalSpreadsheetId: string,
  record: CanonicalWorkOrderRecord
): Promise<DedupeResult> {
  try {
    // Get headers from internal Work_Orders sheet
    const headerMeta = await getSheetHeadersCached(accessToken, internalSpreadsheetId, WORK_ORDERS_SHEET_NAME);
    
    // Find wo_number column
    const woNumberLetter = headerMeta.colLetterByLower["wo_number"] || headerMeta.colLetterByLower["work_order_number"];
    if (!woNumberLetter) {
      // No wo_number column - treat as new
      return { status: "new" };
    }

    // Find existing row by wo_number
    const existingRowIndex = await findRowIndexByColumnValue(
      accessToken,
      internalSpreadsheetId,
      WORK_ORDERS_SHEET_NAME,
      woNumberLetter,
      record.wo_number
    );

    if (existingRowIndex === -1) {
      // No existing row found - this is new
      return { status: "new" };
    }

    // Row exists - read it to check for conflicts
    const { createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");
    const sheets = createSheetsClient(accessToken);
    
    const rowResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: internalSpreadsheetId,
      range: formatSheetRange(WORK_ORDERS_SHEET_NAME, `${existingRowIndex}:${existingRowIndex}`),
    });

    const existingRow = (rowResponse.data.values?.[0] || []) as string[];
    
    // Map existing row to object
    const existingRecord: Partial<CanonicalWorkOrderRecord> = {};
    headerMeta.headersLower.forEach((header, index) => {
      const value = existingRow[index];
      if (value) {
        // Map common field names
        if (header === "jobid" || header === "job_id") {
          existingRecord.jobId = String(value).trim();
        } else if (header === "wo_number" || header === "work_order_number") {
          existingRecord.wo_number = String(value).trim();
        } else if (header === "fmkey" || header === "fm_key") {
          existingRecord.fmKey = String(value).trim() || null;
        } else if (header === "status") {
          existingRecord.status = String(value).trim();
        } else if (header === "customer_name") {
          existingRecord.customer_name = String(value).trim() || null;
        } else if (header === "amount") {
          existingRecord.amount = String(value).trim() || null;
        }
      }
    });

    // Check for conflicts (different data in key fields)
    const conflicts: string[] = [];
    
    if (existingRecord.fmKey && record.fmKey && existingRecord.fmKey !== record.fmKey) {
      conflicts.push(`fmKey: "${existingRecord.fmKey}" vs "${record.fmKey}"`);
    }
    
    if (existingRecord.status && record.status && existingRecord.status !== record.status) {
      conflicts.push(`status: "${existingRecord.status}" vs "${record.status}"`);
    }
    
    if (existingRecord.amount && record.amount && existingRecord.amount !== record.amount) {
      conflicts.push(`amount: "${existingRecord.amount}" vs "${record.amount}"`);
    }

    if (conflicts.length > 0) {
      return {
        status: "conflict",
        existingJobId: existingRecord.jobId,
        existingRecord,
        conflictReason: conflicts.join("; "),
      };
    }

    // No conflicts - this is a duplicate (exact match or only minor differences)
    return {
      status: "duplicate",
      existingJobId: existingRecord.jobId,
      existingRecord,
    };
  } catch (error) {
    // On error, treat as new (safer to import than to skip)
    console.warn("[Dedupe] Error checking for duplicates, treating as new:", error);
    return { status: "new" };
  }
}

/**
 * Deduplicate multiple records.
 * 
 * @param accessToken Google OAuth access token
 * @param internalSpreadsheetId Internal spreadsheet ID
 * @param records Array of canonical records to check
 * @returns Map of record index to dedupe result
 */
export async function dedupeRecords(
  accessToken: string,
  internalSpreadsheetId: string,
  records: CanonicalWorkOrderRecord[]
): Promise<Map<number, DedupeResult>> {
  const results = new Map<number, DedupeResult>();

  // Process in batches to avoid quota issues
  const BATCH_SIZE = 10;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    
    await Promise.all(
      batch.map(async (record, batchIndex) => {
        const globalIndex = i + batchIndex;
        const result = await dedupeRecord(accessToken, internalSpreadsheetId, record);
        results.set(globalIndex, result);
      })
    );
  }

  return results;
}

