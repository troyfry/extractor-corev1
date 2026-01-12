/**
 * Direct Google Sheets ingestion for work orders.
 * 
 * This module handles writing work orders directly to Google Sheets without
 * persisting to the database. Sheets + Drive is the system of record.
 */

import type { ParsedWorkOrder } from "./parsedTypes";
import { writeJobRecord, ensureColumnsExist, type JobRecord, writeWorkOrderRecord, type WorkOrderRecord } from "@/lib/google/sheets";
import { uploadPdfToDrive, getOrCreateFolder } from "@/lib/google/drive";
import { extractWorkOrderDetailsFromPdf } from "./extractFromPdf";

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
    // Missing wo_number - will go to "Verification" sheet
    return `needs_review:${Date.now()}`;
  }
  
  return `${normalizedIssuer}:${normalizedWoNumber}`;
}

/**
 * Write a parsed work order directly to Google Sheets.
 * Uploads PDF to Drive if provided.
 * Extracts full work order details from PDF BEFORE uploading (one-time extraction).
 * 
 * @param parsedWorkOrder Parsed work order (no DB dependency)
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param issuerKey Issuer key derived from email sender domain (for stable jobId)
 * @param pdfBuffer Optional PDF buffer to upload to Drive
 * @param pdfFilename Optional PDF filename
 * @param sheetName Sheet name (default: "Sheet1" or "Verification")
 * @param source Source of the work order (e.g., "email", "manual_upload", "api")
 * @param aiEnabled Whether AI extraction is enabled
 * @param openaiKey OpenAI API key for extraction
 * @param emailSubject Email subject for context (optional)
 */
export async function writeWorkOrderToSheets(
  parsedWorkOrder: ParsedWorkOrder,
  accessToken: string,
  spreadsheetId: string,
  issuerKey: string,
  pdfBuffer?: Buffer,
  pdfFilename?: string,
  sheetName?: string,
  source: string = "manual_upload",
  aiEnabled?: boolean,
  openaiKey?: string | null,
  emailSubject?: string
): Promise<void> {
  const woNumber = parsedWorkOrder.workOrderNumber;
  const jobId = generateJobId(issuerKey, woNumber);

  // Determine which sheet to use
  const targetSheetName = woNumber && woNumber.trim() !== ""
    ? (sheetName || "Sheet1")
    : "Verification";

  // Ensure columns exist in the target sheet
  await ensureColumnsExist(accessToken, spreadsheetId, targetSheetName);

  // Extract full work order details from PDF BEFORE uploading to Drive (one-time extraction)
  if (pdfBuffer && pdfFilename && aiEnabled && openaiKey) {
    try {
      console.log(`[Sheets Ingestion] Extracting full work order details from PDF: ${pdfFilename}`);
      const extractedDetails = await extractWorkOrderDetailsFromPdf({
        pdfBuffer,
        pdfFilename,
        aiEnabled,
        openaiKey,
        fmKey: parsedWorkOrder.fmKey || null,
        workOrderNumber: woNumber || null,
        emailSubject,
      });
      
      // Merge extracted details with parsed work order (extracted takes precedence)
      if (extractedDetails.customerName) parsedWorkOrder.customerName = extractedDetails.customerName;
      if (extractedDetails.serviceAddress) parsedWorkOrder.serviceAddress = extractedDetails.serviceAddress;
      if (extractedDetails.jobType) parsedWorkOrder.jobType = extractedDetails.jobType;
      if (extractedDetails.jobDescription) parsedWorkOrder.jobDescription = extractedDetails.jobDescription;
      if (extractedDetails.amount) parsedWorkOrder.amount = extractedDetails.amount;
      if (extractedDetails.currency) parsedWorkOrder.currency = extractedDetails.currency;
      if (extractedDetails.notes) parsedWorkOrder.notes = extractedDetails.notes;
      if (extractedDetails.priority) parsedWorkOrder.priority = extractedDetails.priority;
      if (extractedDetails.vendorName) parsedWorkOrder.vendorName = extractedDetails.vendorName;
      if (extractedDetails.scheduledDate) parsedWorkOrder.scheduledDate = extractedDetails.scheduledDate;
      
      console.log(`[Sheets Ingestion] ✅ Extracted and merged work order details from PDF`);
    } catch (error) {
      console.warn(`[Sheets Ingestion] Failed to extract details from PDF (non-fatal):`, error);
      // Continue with original parsedWorkOrder values
    }
  }

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
  console.log(`[Sheets Ingestion] Building job record for work order "${woNumber}":`, {
    parsedWorkOrderFmKey: parsedWorkOrder.fmKey,
    parsedWorkOrderFmKeyType: typeof parsedWorkOrder.fmKey,
    parsedWorkOrderFmKeyIsNull: parsedWorkOrder.fmKey === null,
    parsedWorkOrderFmKeyIsUndefined: parsedWorkOrder.fmKey === undefined,
    parsedWorkOrderFmKeyIsEmpty: parsedWorkOrder.fmKey === "",
  });
  
  const record: JobRecord = {
    jobId,
    issuer: issuerKey,
    wo_number: woNumber || "MISSING",
    fmKey: parsedWorkOrder.fmKey || null,
    status: "created",
    original_pdf_url: originalPdfUrl,
    signed_pdf_url: null,
    signed_preview_image_url: null,
    signature_confidence: null,
    created_at: parsedWorkOrder.timestampExtracted || new Date().toISOString(),
    signed_at: null,
  };

  console.log(`[Sheets Ingestion] Writing job record to ${targetSheetName}:`, {
    jobId,
    recordFmKey: record.fmKey,
    recordFmKeyType: typeof record.fmKey,
    wo_number: record.wo_number,
    parsedWorkOrderFmKey: parsedWorkOrder.fmKey,
  });

  // Write to Sheet1 (job process tracking)
  await writeJobRecord(accessToken, spreadsheetId, targetSheetName, record);
  console.log(`[Sheets Ingestion] ✅ Wrote work order to ${targetSheetName}: ${jobId} (fmKey: ${record.fmKey})`);

  // Also write to Work_Orders sheet with detailed fields
  if (woNumber && woNumber.trim() !== "") {
    const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";
    const nowIso = parsedWorkOrder.timestampExtracted || new Date().toISOString();
    
    const workOrderRecord: WorkOrderRecord = {
      jobId,
      fmKey: parsedWorkOrder.fmKey || null,
      wo_number: woNumber,
      status: "OPEN",
      scheduled_date: parsedWorkOrder.scheduledDate ?? null,
      created_at: nowIso,
      timestamp_extracted: nowIso,
      customer_name: parsedWorkOrder.customerName ?? null,
      vendor_name: parsedWorkOrder.vendorName ?? null,
      service_address: parsedWorkOrder.serviceAddress ?? null,
      job_type: parsedWorkOrder.jobType ?? null,
      job_description: parsedWorkOrder.jobDescription ?? null,
      amount: parsedWorkOrder.amount != null ? String(parsedWorkOrder.amount) : null,
      currency: parsedWorkOrder.currency ?? null,
      notes: parsedWorkOrder.notes ?? null,
      priority: parsedWorkOrder.priority ?? null,
      calendar_event_link: null,
      work_order_pdf_link: originalPdfUrl,
      signed_pdf_url: null,
      signed_preview_image_url: null,
      signed_at: null,
      source: source,
      last_updated_at: nowIso,
      file_hash: null,
    };

    try {
      await writeWorkOrderRecord(accessToken, spreadsheetId, WORK_ORDERS_SHEET_NAME, workOrderRecord);
      console.log(`[Sheets Ingestion] ✅ Wrote detailed work order to ${WORK_ORDERS_SHEET_NAME}: ${jobId}`);
    } catch (error) {
      // Log but don't fail - Sheet1 write succeeded, Work_Orders is supplementary
      console.error(`[Sheets Ingestion] ⚠️ Failed to write to ${WORK_ORDERS_SHEET_NAME}, but Sheet1 write succeeded:`, error);
    }
  }
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
 * @param source Source of the work orders (e.g., "email", "manual_upload", "api")
 * @param aiEnabled Whether AI extraction is enabled
 * @param openaiKey OpenAI API key for extraction
 * @param emailSubject Email subject for context (optional)
 */
export async function writeWorkOrdersToSheets(
  parsedWorkOrders: ParsedWorkOrder[],
  accessToken: string,
  spreadsheetId: string,
  issuerKey: string,
  pdfBuffers?: Buffer[],
  pdfFilenames?: string[],
  source: string = "manual_upload",
  aiEnabled?: boolean,
  openaiKey?: string | null,
  emailSubject?: string
): Promise<void> {
  // Ensure "Verification" sheet exists
  await ensureColumnsExist(accessToken, spreadsheetId, "Verification");

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
      pdfFilename,
      undefined, // sheetName - use default
      source,
      aiEnabled,
      openaiKey,
      emailSubject
    );
  }
}

