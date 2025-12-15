/**
 * Direct Google Sheets ingestion for work orders.
 * 
 * This module handles writing work orders directly to Google Sheets without
 * persisting to the database. Sheets + Drive is the system of record.
 */

import type { ParsedWorkOrder } from "./parsedTypes";
import { writeJobRecord, ensureColumnsExist, type JobRecord } from "@/lib/google/sheets";
import { uploadPdfToDrive, getOrCreateFolder } from "@/lib/google/drive";

/**
 * Normalize a string for use in jobId.
 * Removes special characters, converts to lowercase, trims whitespace.
 */
function normalizeForJobId(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "_") // Replace non-alphanumeric with underscore
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, ""); // Remove leading/trailing underscores
}

/**
 * Generate deterministic jobId from issuer and wo_number.
 * Format: normalize(issuer) + ":" + normalize(wo_number)
 */
export function generateJobId(issuer: string | null, woNumber: string | null): string {
  const normalizedIssuer = normalizeForJobId(issuer || "unknown");
  const normalizedWoNumber = normalizeForJobId(woNumber || "missing");
  
  if (!woNumber || woNumber.trim() === "") {
    // Missing wo_number - will go to "Needs Review" sheet
    return `needs_review:${Date.now()}`;
  }
  
  return `${normalizedIssuer}:${normalizedWoNumber}`;
}

/**
 * Write a parsed work order directly to Google Sheets.
 * Uploads PDF to Drive if provided.
 * 
 * @param parsedWorkOrder Parsed work order (no DB dependency)
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param issuerKey Issuer key derived from email sender domain (for stable jobId)
 * @param pdfBuffer Optional PDF buffer to upload to Drive
 * @param pdfFilename Optional PDF filename
 * @param sheetName Sheet name (default: "Sheet1" or "Needs Review")
 */
export async function writeWorkOrderToSheets(
  parsedWorkOrder: ParsedWorkOrder,
  accessToken: string,
  spreadsheetId: string,
  issuerKey: string,
  pdfBuffer?: Buffer,
  pdfFilename?: string,
  sheetName?: string
): Promise<void> {
  const woNumber = parsedWorkOrder.workOrderNumber;
  const jobId = generateJobId(issuerKey, woNumber);

  // Determine which sheet to use
  const targetSheetName = woNumber && woNumber.trim() !== ""
    ? (sheetName || "Sheet1")
    : "Needs Review";

  // Ensure columns exist in the target sheet
  await ensureColumnsExist(accessToken, spreadsheetId, targetSheetName);

  // Upload PDF to Drive if provided (required - throw on failure)
  let originalPdfUrl: string | null = null;
  if (pdfBuffer && pdfFilename) {
    // Create or get "Work Orders" folder in Drive
    const folderId = await getOrCreateFolder(accessToken, "Work Orders");
    
    // Upload PDF (throw on failure - label should not be removed if Drive upload fails)
    const driveResult = await uploadPdfToDrive(
      accessToken,
      pdfBuffer,
      pdfFilename,
      folderId
    );
    
    originalPdfUrl = driveResult.webViewLink;
    console.log(`[Sheets Ingestion] Uploaded PDF to Drive: ${pdfFilename} -> ${originalPdfUrl}`);
  }

  // Build job record
  const record: JobRecord = {
    jobId,
    issuer: issuerKey,
    wo_number: woNumber || "MISSING",
    status: "created",
    original_pdf_url: originalPdfUrl,
    signed_pdf_url: null,
    created_at: parsedWorkOrder.timestampExtracted || new Date().toISOString(),
    signed_at: null,
  };

  // Write to Sheets
  await writeJobRecord(accessToken, spreadsheetId, targetSheetName, record);
  console.log(`[Sheets Ingestion] Wrote work order to ${targetSheetName}: ${jobId}`);
}

/**
 * Write multiple parsed work orders to Google Sheets.
 * 
 * @param parsedWorkOrders Array of parsed work orders
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param issuerKey Issuer key derived from email sender domain (for stable jobId)
 * @param pdfBuffers Optional array of PDF buffers (must match parsedWorkOrders length)
 * @param pdfFilenames Optional array of PDF filenames (must match parsedWorkOrders length)
 */
export async function writeWorkOrdersToSheets(
  parsedWorkOrders: ParsedWorkOrder[],
  accessToken: string,
  spreadsheetId: string,
  issuerKey: string,
  pdfBuffers?: Buffer[],
  pdfFilenames?: string[]
): Promise<void> {
  // Ensure "Needs Review" sheet exists
  await ensureColumnsExist(accessToken, spreadsheetId, "Needs Review");

  // Write each work order
  for (let i = 0; i < parsedWorkOrders.length; i++) {
    const parsedWorkOrder = parsedWorkOrders[i];
    const pdfBuffer = pdfBuffers?.[i];
    const pdfFilename = pdfFilenames?.[i];

    await writeWorkOrderToSheets(
      parsedWorkOrder,
      accessToken,
      spreadsheetId,
      issuerKey,
      pdfBuffer,
      pdfFilename
    );
  }
}

