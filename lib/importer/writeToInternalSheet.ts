/**
 * Write imported records to internal sheet.
 * 
 * NEVER writes to external sheets. Only writes to our internal Work_Orders sheet.
 * Conflicts are written to Verification sheet for manual review.
 */

import type { CanonicalWorkOrderRecord, DedupeResult } from "./types";
import { writeWorkOrderRecord, type WorkOrderRecord } from "@/lib/google/sheets";
import { appendSignedNeedsReviewRow, type SignedNeedsReviewRecord } from "@/lib/workOrders/signedSheets";

const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

/**
 * Write imported records to internal sheet.
 * 
 * @param accessToken Google OAuth access token
 * @param internalSpreadsheetId Internal spreadsheet ID (our sheet)
 * @param records Array of canonical records to import
 * @param dedupeResults Map of record index to dedupe result
 * @returns Import summary
 */
export async function writeImportedRecords(
  accessToken: string,
  internalSpreadsheetId: string,
  records: CanonicalWorkOrderRecord[],
  dedupeResults: Map<number, DedupeResult>
): Promise<{
  imported: number;
  skipped: number;
  conflicts: number;
  errors: string[];
}> {
  const summary = {
    imported: 0,
    skipped: 0,
    conflicts: 0,
    errors: [] as string[],
  };

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const dedupe = dedupeResults.get(i);

    if (!dedupe) {
      summary.errors.push(`Row ${i + 1}: No dedupe result`);
      continue;
    }

    try {
      if (dedupe.status === "new") {
        // Write new record to Work_Orders sheet
        // Convert CanonicalWorkOrderRecord to WorkOrderRecord
        const workOrderRecord: WorkOrderRecord = {
          jobId: record.jobId,
          fmKey: record.fmKey,
          wo_number: record.wo_number,
          status: record.status,
          scheduled_date: record.scheduled_date,
          created_at: record.created_at,
          timestamp_extracted: record.timestamp_extracted,
          customer_name: record.customer_name,
          vendor_name: record.vendor_name,
          service_address: record.service_address,
          job_type: record.job_type,
          job_description: record.job_description,
          amount: record.amount,
          currency: record.currency,
          notes: record.notes,
          priority: record.priority,
          calendar_event_link: record.calendar_event_link,
          work_order_pdf_link: record.work_order_pdf_link,
          signed_pdf_url: record.signed_pdf_url,
          signed_preview_image_url: record.signed_preview_image_url,
          signed_at: null,
          source: record.source,
          last_updated_at: record.last_updated_at,
          file_hash: record.file_hash || null,
        };
        await writeWorkOrderRecord(
          accessToken,
          internalSpreadsheetId,
          WORK_ORDERS_SHEET_NAME,
          workOrderRecord
        );
        summary.imported++;
      } else if (dedupe.status === "duplicate") {
        // Skip duplicates
        summary.skipped++;
      } else if (dedupe.status === "conflict") {
        // Write conflict to Verification sheet for manual review
        const conflictRecord: SignedNeedsReviewRecord = {
          fmKey: record.fmKey || null,
          signed_pdf_url: null,
          preview_image_url: null,
          raw_text: `Import conflict: ${dedupe.conflictReason || "Data mismatch"}`,
          confidence: "unknown",
          reason: "IMPORT_CONFLICT",
          manual_work_order_number: record.wo_number,
          resolved: "FALSE",
          reason_note: `External import conflict. Existing: ${JSON.stringify(dedupe.existingRecord)}. New: ${JSON.stringify(record)}`,
        };
        await appendSignedNeedsReviewRow(accessToken, internalSpreadsheetId, conflictRecord);
        summary.conflicts++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      summary.errors.push(`Row ${i + 1}: ${errorMessage}`);
    }
  }

  return summary;
}

