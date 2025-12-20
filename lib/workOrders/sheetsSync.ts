/**
 * Google Sheets synchronization for job records.
 * 
 * This module handles writing job records to Google Sheets when work orders are ingested.
 * Google Sheets is the source of truth for job records.
 */

import type { WorkOrder } from "./types";
import { writeJobRecord, type JobRecord } from "@/lib/google/sheets";

/**
 * Write a work order to Google Sheets as a job record.
 * 
 * @param workOrder Work order to write
 * @param accessToken Google OAuth access token (optional - only writes if provided)
 * @param spreadsheetId Google Sheets spreadsheet ID (optional - only writes if provided)
 * @param sheetName Sheet name (default: "Sheet1")
 * @param issuer Issuer name (e.g., vendor name or "Unknown")
 */
export async function syncWorkOrderToSheets(
  workOrder: WorkOrder,
  accessToken: string | null,
  spreadsheetId: string | null,
  sheetName: string = "Sheet1",
  issuer: string | null = null
): Promise<void> {
  // Only write to Sheets if both accessToken and spreadsheetId are provided
  if (!accessToken || !spreadsheetId) {
    console.log(
      `[Sheets Sync] Skipping Google Sheets sync for jobId ${workOrder.jobId}: accessToken=${!!accessToken}, spreadsheetId=${!!spreadsheetId}`
    );
    return;
  }

  try {
    const record: JobRecord = {
      jobId: workOrder.jobId,
      issuer: issuer || workOrder.vendorName || "Unknown",
      wo_number: workOrder.workOrderNumber,
      fmKey: null, // Not matched in this flow (only in Pro ingestion)
      status: "created", // Default status
      original_pdf_url: workOrder.workOrderPdfLink || null,
      signed_pdf_url: null, // Will be updated when PDF is signed
      signed_preview_image_url: null,
      signature_confidence: null,
      created_at: workOrder.createdAt,
      signed_at: null, // Will be updated when PDF is signed
    };

    console.log(`[Sheets Sync] Writing job record to Sheets:`, {
      jobId: record.jobId,
      wo_number: record.wo_number,
      spreadsheetId: `${spreadsheetId.substring(0, 10)}...`,
      sheetName,
    });

    await writeJobRecord(accessToken, spreadsheetId, sheetName, record);
    console.log(`[Sheets Sync] Successfully synced job record to Google Sheets: ${workOrder.jobId}`);
  } catch (error) {
    // Log error but don't throw - Sheets sync should not block work order creation
    console.error(`[Sheets Sync] Error syncing work order to Google Sheets:`, error);
    if (error instanceof Error) {
      console.error(`[Sheets Sync] Error details:`, {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
  }
}

/**
 * Sync multiple work orders to Google Sheets.
 * 
 * @param workOrders Array of work orders to sync
 * @param accessToken Google OAuth access token (optional)
 * @param spreadsheetId Google Sheets spreadsheet ID (optional)
 * @param sheetName Sheet name (default: "Sheet1")
 * @param issuer Issuer name (default: extracted from work orders)
 */
export async function syncWorkOrdersToSheets(
  workOrders: WorkOrder[],
  accessToken: string | null,
  spreadsheetId: string | null,
  sheetName: string = "Sheet1",
  issuer: string | null = null
): Promise<void> {
  if (!accessToken || !spreadsheetId) {
    console.log(
      `[Sheets Sync] Skipping Google Sheets sync for ${workOrders.length} work orders: accessToken or spreadsheetId not provided`
    );
    return;
  }

  // Sync each work order
  for (const workOrder of workOrders) {
    await syncWorkOrderToSheets(
      workOrder,
      accessToken,
      spreadsheetId,
      sheetName,
      issuer || workOrder.vendorName || null
    );
  }
}

