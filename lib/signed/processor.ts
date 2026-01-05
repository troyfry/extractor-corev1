/**
 * Unified signed PDF processing function.
 * 
 * This is the "boss" function that centralizes all signed PDF processing logic.
 * All signed PDF flows (upload, Gmail, etc.) should route through this function.
 * 
 * Flow:
 * 1. Validate inputs
 * 2. Load template/profile (points + expected page dims)
 * 3. Call Python OCR service
 * 4. Decide outcome (needsReview true/false)
 * 5. Write to Sheets
 * 6. Return result
 */

import { getTemplateConfigForFmKey, type TemplateConfig } from "@/lib/workOrders/templateConfig";
import { callSignedOcrService, type SignedOcrResult } from "@/lib/workOrders/signedOcr";
import { appendSignedNeedsReviewRow, type SignedNeedsReviewRecord } from "@/lib/workOrders/signedSheets";
import { writeWorkOrderRecord, findWorkOrderRecordByJobId, updateJobWithSignedInfoByWorkOrderNumber, type WorkOrderRecord } from "@/lib/google/sheets";
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";
import { uploadPdfToDrive, getOrCreateFolder } from "@/lib/google/drive";
import { uploadSnippetImageToDrive } from "@/lib/drive-snippets";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";

const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";
const MAIN_SHEET_NAME = process.env.GOOGLE_SHEETS_MAIN_SHEET_NAME || "Sheet1";
const SIGNED_DRIVE_FOLDER_NAME = process.env.GOOGLE_DRIVE_SIGNED_FOLDER_NAME || "Signed Work Orders";

export interface ProcessSignedPdfParams {
  pdfBytes: Buffer | Uint8Array;
  originalFilename?: string;
  page: number; // 1-based
  fmKey: string;
  spreadsheetId: string;
  accessToken: string;
  source: "UPLOAD" | "GMAIL";
  sourceMeta?: {
    gmailMessageId?: string;
    gmailAttachmentId?: string;
    gmailThreadId?: string;
    gmailFrom?: string;
    gmailSubject?: string;
    gmailDate?: string;
  };
  dpi?: number;
  woNumberOverride?: string;
  manualReason?: string;
}

export interface ProcessSignedPdfResult {
  workOrderNumber: string | null;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  snippetImageUrl?: string | null;
  snippetDriveUrl?: string | null;
  signedPdfUrl?: string | null;
  normalized?: boolean | null;
  needsReview: boolean;
  sheetRowId?: string | null;
  debug?: {
    templateId?: string;
    page?: number;
    ocrNormalized?: boolean;
  };
}

/**
 * Unified signed PDF processing function.
 * 
 * This function handles the complete flow:
 * - Validates inputs
 * - Loads template/profile
 * - Calls Python OCR service
 * - Decides outcome
 * - Writes to Sheets
 * - Returns result
 */
export async function processSignedPdfUnified(
  params: ProcessSignedPdfParams
): Promise<ProcessSignedPdfResult> {
  const {
    pdfBytes,
    originalFilename = "signed-work-order.pdf",
    page = 1,
    fmKey,
    spreadsheetId,
    accessToken,
    source,
    sourceMeta,
    dpi = 200,
    woNumberOverride,
    manualReason,
  } = params;

  // Step 1: Validate inputs
  if (!pdfBytes || pdfBytes.length === 0) {
    throw new Error("pdfBytes is required and must not be empty");
  }
  if (!fmKey || !fmKey.trim()) {
    throw new Error("fmKey is required");
  }
  if (!spreadsheetId) {
    throw new Error("spreadsheetId is required");
  }
  if (!accessToken) {
    throw new Error("accessToken is required");
  }
  if (page < 1) {
    throw new Error("page must be >= 1 (1-based)");
  }

  const normalizedFmKey = normalizeFmKey(fmKey);
  const pdfBuffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);

  // Log start
  console.log("[Signed Processor] Starting unified processing:", {
    source,
    fmKey: normalizedFmKey,
    page,
    filename: originalFilename,
  });

  // Step 2: Load template/profile (points + expected page dims)
  let templateConfig: TemplateConfig;
  try {
    templateConfig = await getTemplateConfigForFmKey(fmKey);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("TEMPLATE_NOT_CONFIGURED") || errorMessage.includes("not found")) {
      throw new Error(`Template not configured for FM key: ${normalizedFmKey}. Please configure a template first.`);
    }
    throw new Error(`Failed to load template for FM key ${normalizedFmKey}: ${errorMessage}`);
  }

  // Validate template has required PDF points
  if (
    templateConfig.xPt === undefined ||
    templateConfig.yPt === undefined ||
    templateConfig.wPt === undefined ||
    templateConfig.hPt === undefined ||
    templateConfig.pageWidthPt === undefined ||
    templateConfig.pageHeightPt === undefined
  ) {
    throw new Error(
      `Template for FM key ${normalizedFmKey} is missing required PDF points. ` +
      `Required: xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt`
    );
  }

  // Step 3: Call Python OCR service
  const ocrResult = await callSignedOcrService(pdfBuffer, originalFilename, {
    templateId: templateConfig.templateId,
    page,
    region: templateConfig.region, // Required by SignedOcrConfig (legacy support, can be null)
    xPt: templateConfig.xPt,
    yPt: templateConfig.yPt,
    wPt: templateConfig.wPt,
    hPt: templateConfig.hPt,
    pageWidthPt: templateConfig.pageWidthPt,
    pageHeightPt: templateConfig.pageHeightPt,
    dpi,
  });

  // Log after OCR
  console.log("[Signed Processor] OCR complete:", {
    workOrderNumber: ocrResult.woNumber,
    confidenceLabel: ocrResult.confidenceLabel,
    confidenceRaw: ocrResult.confidenceRaw,
  });

  // Step 4: Decide outcome
  let workOrderNumber: string | null = ocrResult.woNumber;
  let needsReview: boolean;

  // If override provided, use it and skip review
  if (woNumberOverride) {
    workOrderNumber = woNumberOverride.trim();
    needsReview = false;
  } else {
    // Decide based on OCR result
    // High/medium confidence with work order number = no review needed
    // Low confidence or no work order number = needs review
    needsReview = !workOrderNumber || ocrResult.confidenceLabel === "low";
  }

  // Log before sheets write
  console.log("[Signed Processor] Writing to sheets:", {
    needsReview,
    workOrderNumber,
  });

  // Step 5: Write to Sheets
  // Upload PDF to Drive first
  const signedFolderId = await getOrCreateFolder(accessToken, SIGNED_DRIVE_FOLDER_NAME);
  const signedPdfUpload = await uploadPdfToDrive(
    accessToken,
    pdfBuffer,
    originalFilename,
    signedFolderId
  );
  const signedPdfUrl = signedPdfUpload.webViewLink || signedPdfUpload.webContentLink;

  // Upload snippet image if available (OCR service returns data URL with base64)
  let snippetDriveUrl: string | null = null;
  if (ocrResult.snippetImageUrl) {
    try {
      // Extract base64 from data URL (format: "data:image/png;base64,<base64>")
      const [, base64Part] = ocrResult.snippetImageUrl.split(",", 2);
      if (base64Part) {
        const pngBuffer = Buffer.from(base64Part, "base64");
        const fileNameParts = [
          "snippet",
          normalizedFmKey || "unknown",
          workOrderNumber || "no-wo",
          Date.now().toString(),
        ];
        const fileName = fileNameParts.join("-") + ".png";

        snippetDriveUrl = await uploadSnippetImageToDrive({
          accessToken,
          fileName,
          pngBuffer,
          folderIdOverride: signedFolderId,
        });
      }
    } catch (error) {
      console.warn("[Signed Processor] Failed to upload snippet image:", error);
    }
  }

  let sheetRowId: string | null = null;

  if (needsReview) {
    // Write to Needs Review sheet
    const reviewRecord: SignedNeedsReviewRecord = {
      fmKey: normalizedFmKey,
      signed_pdf_url: signedPdfUrl,
      preview_image_url: snippetDriveUrl,
      raw_text: ocrResult.rawText,
      confidence: ocrResult.confidenceLabel,
      reason: manualReason || (needsReview ? "Low confidence or no work order number extracted" : null),
      manual_work_order_number: null,
      resolved: null,
      resolved_at: null,
      source: source,
      gmail_message_id: sourceMeta?.gmailMessageId || null,
      gmail_attachment_id: sourceMeta?.gmailAttachmentId || null,
      gmail_subject: sourceMeta?.gmailSubject || null,
      gmail_from: sourceMeta?.gmailFrom || null,
      gmail_date: sourceMeta?.gmailDate || null,
    };

    await appendSignedNeedsReviewRow(accessToken, spreadsheetId, reviewRecord);
    // Note: sheetRowId not available from appendSignedNeedsReviewRow
  } else {
    // Update Work Orders sheet
    if (workOrderNumber) {
      const jobId = generateJobId(null, workOrderNumber);
      
      // Find existing work order
      const existingWorkOrder = await findWorkOrderRecordByJobId(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        jobId
      );

      const nowIso = new Date().toISOString();
      const mergedWorkOrder: WorkOrderRecord = {
        jobId,
        fmKey: normalizedFmKey,
        wo_number: workOrderNumber,
        status: "SIGNED",
        scheduled_date: existingWorkOrder?.scheduled_date ?? null,
        created_at: existingWorkOrder?.created_at ?? nowIso,
        timestamp_extracted: existingWorkOrder?.timestamp_extracted ?? nowIso,
        customer_name: existingWorkOrder?.customer_name ?? null,
        vendor_name: existingWorkOrder?.vendor_name ?? null,
        service_address: existingWorkOrder?.service_address ?? null,
        job_type: existingWorkOrder?.job_type ?? null,
        job_description: existingWorkOrder?.job_description ?? null,
        amount: existingWorkOrder?.amount ?? null,
        currency: existingWorkOrder?.currency ?? null,
        notes: existingWorkOrder?.notes ?? null,
        priority: existingWorkOrder?.priority ?? null,
        calendar_event_link: existingWorkOrder?.calendar_event_link ?? null,
        work_order_pdf_link: existingWorkOrder?.work_order_pdf_link ?? null,
        signed_pdf_url: signedPdfUrl,
        signed_preview_image_url: snippetDriveUrl,
        signed_at: nowIso,
        source: existingWorkOrder?.source ?? (source === "UPLOAD" ? "signed_upload" : "signed_gmail"),
        last_updated_at: nowIso,
      };

      await writeWorkOrderRecord(accessToken, spreadsheetId, WORK_ORDERS_SHEET_NAME, mergedWorkOrder);

      // Also update Sheet1 if work order exists there
      try {
        await updateJobWithSignedInfoByWorkOrderNumber(
          accessToken,
          spreadsheetId,
          MAIN_SHEET_NAME,
          workOrderNumber,
          {
            signedPdfUrl,
            signedPreviewImageUrl: snippetDriveUrl,
            confidence: ocrResult.confidenceLabel,
            signedAt: nowIso,
            statusOverride: "SIGNED",
            fmKey: normalizedFmKey,
          }
        );
      } catch (error) {
        // Non-fatal: Sheet1 update may fail if work order doesn't exist there
        console.warn("[Signed Processor] Failed to update Sheet1 (non-fatal):", error);
      }
    }
  }

  // Step 6: Return result
  return {
    workOrderNumber,
    confidence: ocrResult.confidenceRaw,
    confidenceLabel: ocrResult.confidenceLabel,
    snippetImageUrl: ocrResult.snippetImageUrl,
    snippetDriveUrl,
    signedPdfUrl,
    normalized: null, // Python service normalization status not exposed in SignedOcrResult yet
    needsReview,
    sheetRowId,
    debug: {
      templateId: templateConfig.templateId,
      page,
    },
  };
}

