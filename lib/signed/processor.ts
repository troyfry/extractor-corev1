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
import { writeWorkOrderRecord, findWorkOrderRecordByJobId, updateJobWithSignedInfoByWorkOrderNumber, createSheetsClient, type WorkOrderRecord } from "@/lib/google/sheets";
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";
import { uploadPdfToDrive, getOrCreateFolder } from "@/lib/google/drive";
import { uploadSnippetImageToDrive } from "@/lib/drive-snippets";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";
import { NEEDS_REVIEW_REASONS } from "@/lib/workOrders/reasons";

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
  // 3-layer extraction results (optional, passed from API route)
  extractionResult?: {
    workOrderNumber: string | null;
    method: "DIGITAL_TEXT" | "OCR" | "AI_RESCUE";
    confidence: number;
    rationale?: string;
    candidates?: Array<{
      value: string;
      score: number;
      source: "DIGITAL_TEXT" | "OCR" | "AI_RESCUE";
      sourceSnippet?: string;
    }>;
  } | null;
}

export interface ProcessSignedPdfResult {
  workOrderNumber: string | null;
  woNumber: string | null; // Alias for workOrderNumber (standardized field name)
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  snippetImageUrl?: string | null;
  snippetDriveUrl?: string | null;
  snippetUrl?: string | null; // Standardized: prefers snippetDriveUrl, falls back to snippetImageUrl
  signedPdfUrl?: string | null;
  normalized?: boolean | null;
  needsReview: boolean;
  needsReviewReason?: string | null; // Reason why review is needed (only when needsReview === true)
  alreadyProcessed?: boolean; // True if work order was already signed/processed
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
  let templateConfig: TemplateConfig | null = null;
  let templateError: Error | null = null;
  try {
    templateConfig = await getTemplateConfigForFmKey(fmKey);
  } catch (error) {
    templateError = error instanceof Error ? error : new Error(String(error));
    const errorMessage = templateError.message;
    if (!errorMessage.includes("TEMPLATE_NOT_CONFIGURED") && !errorMessage.includes("not found")) {
      // Only throw for unexpected errors
      throw new Error(`Failed to load template for FM key ${normalizedFmKey}: ${errorMessage}`);
    }
    // For TEMPLATE_NOT_CONFIGURED, we'll handle it gracefully below
    console.log(`[Signed Processor] Template not configured for fmKey="${normalizedFmKey}". Handling gracefully by adding to Needs Review.`);
  }

  // If template config is missing, handle gracefully by adding to Needs Review
  if (!templateConfig) {
    const isTemplateNotConfigured = templateError?.message?.includes("TEMPLATE_NOT_CONFIGURED") || false;
    const reason = isTemplateNotConfigured 
      ? NEEDS_REVIEW_REASONS.TEMPLATE_NOT_CONFIGURED 
      : NEEDS_REVIEW_REASONS.TEMPLATE_NOT_FOUND;
    
    console.log(`[Signed Processor] Adding PDF to Needs Review with reason: ${reason}`);

    // Upload PDF to Drive even if template not configured (so it's available for review)
    let signedPdfUrl: string | null = null;
    try {
      const signedFolderId = await getOrCreateFolder(accessToken, SIGNED_DRIVE_FOLDER_NAME);
      const signedPdfUpload = await uploadPdfToDrive(
        accessToken,
        pdfBuffer,
        originalFilename,
        signedFolderId
      );
      signedPdfUrl = signedPdfUpload.webViewLink || signedPdfUpload.webContentLink;
    } catch (uploadError) {
      console.warn("[Signed Processor] Failed to upload PDF to Drive for needs review:", uploadError);
    }

    // Add to Needs Review sheet
    const reviewRecord: SignedNeedsReviewRecord = {
      fmKey: normalizedFmKey,
      signed_pdf_url: signedPdfUrl,
      preview_image_url: null,
      raw_text: "",
      confidence: "low",
      reason,
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

    // Return NEEDS_REVIEW result
    return {
      workOrderNumber: null,
      woNumber: null,
      confidence: 0,
      confidenceLabel: "low",
      snippetImageUrl: null,
      snippetDriveUrl: null,
      snippetUrl: null,
      signedPdfUrl,
      normalized: null,
      needsReview: true,
      needsReviewReason: reason,
      sheetRowId: null,
      debug: {
        templateId: null,
        page: null,
        ocrNormalized: null,
      },
    };
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

  // If override provided, use it
  if (woNumberOverride) {
    workOrderNumber = woNumberOverride.trim();
  }

  // Check if work order exists in Sheet1 or Work_Orders before deciding
  let workOrderExists = false;
  let workOrderAlreadySigned = false;
  if (workOrderNumber) {
    const jobId = generateJobId(null, workOrderNumber);
    
    // Check Work_Orders sheet
    const existingWorkOrder = await findWorkOrderRecordByJobId(
      accessToken,
      spreadsheetId,
      WORK_ORDERS_SHEET_NAME,
      jobId
    );
    
    if (existingWorkOrder) {
      workOrderExists = true;
      // Check if work order is already signed (high confidence extraction + already SIGNED status)
      const isSigned = existingWorkOrder.status?.toUpperCase() === "SIGNED" || 
                       (existingWorkOrder.signed_pdf_url && existingWorkOrder.signed_pdf_url.trim() !== "");
      
      // If we have high confidence extraction and work order is already signed, mark as already processed
      if (isSigned && params.extractionResult && params.extractionResult.confidence >= 0.80) {
        workOrderAlreadySigned = true;
      }
    } else {
      // Check Sheet1 by wo_number
      try {
        // Use a lightweight check: try to find the row by wo_number
        const sheets = createSheetsClient(accessToken);
        const allDataResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${MAIN_SHEET_NAME}!A:Z`, // Get first 26 columns
        });
        
        const rows = allDataResponse.data.values || [];
        if (rows.length > 0) {
          const headers = rows[0] as string[];
          const headersLower = headers.map((h) => h.toLowerCase().trim());
          const woColIndex = headersLower.indexOf("wo_number");
          const statusColIndex = headersLower.indexOf("status");
          const signedPdfColIndex = headersLower.indexOf("signed_pdf_url");
          
          if (woColIndex !== -1) {
            const normalizedTarget = workOrderNumber.trim();
            for (let i = 1; i < rows.length; i++) {
              const row = rows[i];
              const cellValue = (row?.[woColIndex] || "").trim();
              if (cellValue && cellValue === normalizedTarget) {
                workOrderExists = true;
                
                // Check if already signed
                const status = statusColIndex !== -1 ? (row[statusColIndex] || "").trim().toUpperCase() : "";
                const signedPdfUrl = signedPdfColIndex !== -1 ? (row[signedPdfColIndex] || "").trim() : "";
                const isSigned = status === "SIGNED" || signedPdfUrl !== "";
                
                if (isSigned && params.extractionResult && params.extractionResult.confidence >= 0.80) {
                  workOrderAlreadySigned = true;
                }
                break;
              }
            }
          }
        }
      } catch (error) {
        // Non-fatal: if we can't check Sheet1, assume it doesn't exist
        console.warn("[Signed Processor] Could not check Sheet1 for work order existence:", error);
      }
    }
  }

  // Decide needsReview:
  // - If work order already signed with high confidence extraction → blocked (already processed)
  // - If no work order number OR low confidence → needs review
  // - If work order number but work order doesn't exist in sheets → needs review (original work order not found)
  // - If work order exists and (high/medium confidence OR override) → no review needed
  if (workOrderAlreadySigned) {
    // Work order already processed - return early without updating
    return {
      workOrderNumber,
      woNumber: workOrderNumber,
      confidence: params.extractionResult?.confidence || ocrResult.confidenceRaw,
      confidenceLabel: params.extractionResult && params.extractionResult.confidence >= 0.80 ? "high" : ocrResult.confidenceLabel,
      snippetImageUrl: null,
      snippetDriveUrl: null,
      snippetUrl: null,
      signedPdfUrl: null,
      normalized: null,
      needsReview: false, // Not needs review, but blocked
      needsReviewReason: "Work order already processed (already signed)",
      alreadyProcessed: true,
      sheetRowId: null,
      debug: {
        templateId: templateConfig.templateId,
        page,
      },
    };
  }
  
  if (!workOrderNumber || ocrResult.confidenceLabel === "low") {
    needsReview = true;
  } else if (!workOrderExists) {
    needsReview = true; // Original work order not found
  } else {
    // Work order exists and we have a valid work order number
    needsReview = false;
  }

  // Log before sheets write
  console.log("[Signed Processor] Writing to sheets:", {
    needsReview,
    workOrderNumber,
    workOrderExists,
    confidenceLabel: ocrResult.confidenceLabel,
  });

  // Step 5: Write to Sheets
  // Only upload PDF to Drive if work order exists (signed PDFs should only be attached to existing work orders)
  let signedPdfUrl: string | null = null;
  let snippetDriveUrl: string | null = null;
  
  if (!needsReview && workOrderExists) {
    // Upload PDF to Drive only if work order exists
    const signedFolderId = await getOrCreateFolder(accessToken, SIGNED_DRIVE_FOLDER_NAME);
    const signedPdfUpload = await uploadPdfToDrive(
      accessToken,
      pdfBuffer,
      originalFilename,
      signedFolderId
    );
    signedPdfUrl = signedPdfUpload.webViewLink || signedPdfUpload.webContentLink;

    // Upload snippet image if available (OCR service returns data URL with base64)
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
  }

  let sheetRowId: string | null = null;

  // Compute needsReviewReason (standardized field for return value)
  const needsReviewReason: string | null = needsReview ? (
    manualReason || (
      !workOrderNumber ? "No work order number extracted" :
      !workOrderExists ? "Original work order not found in Sheet1 or Work_Orders" :
      ocrResult.confidenceLabel === "low" ? "Low confidence" :
      "Low confidence or no work order number extracted"
    )
  ) : null;

  if (needsReview) {
    // Write to Needs Review sheet
    // Determine confidence: if work order doesn't exist, mark as "blocked"
    // Otherwise, use OCR confidence (quality only)
    let reviewConfidence: "high" | "medium" | "low" | "unknown" | "blocked" | null;
    if (!workOrderExists && workOrderNumber) {
      // Work order doesn't exist - this is a blocking issue, not an OCR quality issue
      reviewConfidence = "blocked";
    } else {
      // Use OCR confidence to reflect extraction quality
      reviewConfidence = ocrResult.confidenceLabel;
    }

    const reviewRecord: SignedNeedsReviewRecord = {
      fmKey: normalizedFmKey,
      signed_pdf_url: signedPdfUrl,
      preview_image_url: snippetDriveUrl,
      raw_text: ocrResult.rawText,
      confidence: reviewConfidence, // "blocked" if work order doesn't exist, otherwise OCR confidence
      ocr_confidence_raw: ocrResult.confidenceRaw, // Always store OCR quality separately
      reason: needsReviewReason, // Use computed reason
      manual_work_order_number: null,
      resolved: null,
      resolved_at: null,
      source: source,
      gmail_message_id: sourceMeta?.gmailMessageId || null,
      gmail_attachment_id: sourceMeta?.gmailAttachmentId || null,
      gmail_subject: sourceMeta?.gmailSubject || null,
      gmail_from: sourceMeta?.gmailFrom || null,
      gmail_date: sourceMeta?.gmailDate || null,
      // 3-layer extraction results
      extraction_method: params.extractionResult?.method || null,
      extraction_confidence: params.extractionResult?.confidence || null,
      extraction_rationale: params.extractionResult?.rationale || null,
      extracted_work_order_number: params.extractionResult?.workOrderNumber || null,
      // Candidate list (for multiple candidates scenario)
      normalized_candidates: params.extractionResult?.candidates && params.extractionResult.candidates.length > 0
        ? params.extractionResult.candidates.map(c => c.value).join("|")
        : null,
      // Candidate sources (JSON for DB migration - stores snippets)
      candidate_sources: params.extractionResult?.candidates && params.extractionResult.candidates.length > 0
        ? JSON.stringify(params.extractionResult.candidates.map(c => ({
            value: c.value,
            snippet: c.sourceSnippet || null,
            score: c.score,
            source: c.source,
          })))
        : null,
      chosen_candidate: params.extractionResult?.workOrderNumber || null,
    };

    await appendSignedNeedsReviewRow(accessToken, spreadsheetId, reviewRecord);
    // Note: sheetRowId not available from appendSignedNeedsReviewRow
  } else {
    // Update Work Orders sheet - ONLY update status and signed fields
    // All other data was already extracted at upload time (one and done)
    if (workOrderNumber) {
      const jobId = generateJobId(null, workOrderNumber);
      
      const nowIso = new Date().toISOString();
      
      // Use partial update to only change status and signed fields
      // This preserves all existing data that was extracted at upload time
      const { updateWorkOrderRecordPartial } = await import("@/lib/google/sheets");
      await updateWorkOrderRecordPartial(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        jobId,
        workOrderNumber,
        {
          status: "SIGNED",
          signed_pdf_url: signedPdfUrl,
          signed_preview_image_url: snippetDriveUrl,
          signed_at: nowIso,
          last_updated_at: nowIso,
        }
      );
      
      console.log(`[Signed Processor] ✅ Updated work order status to SIGNED: ${jobId}`);

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

  // Step 6: Return standardized result
  // snippetUrl: prefer snippetDriveUrl (uploaded to Drive), fall back to snippetImageUrl (data URL from OCR)
  const snippetUrl = snippetDriveUrl || ocrResult.snippetImageUrl || null;

  return {
    workOrderNumber,
    woNumber: workOrderNumber, // Standardized alias
    confidence: ocrResult.confidenceRaw,
    confidenceLabel: ocrResult.confidenceLabel,
    snippetImageUrl: ocrResult.snippetImageUrl,
    snippetDriveUrl,
    snippetUrl, // Standardized: prefers snippetDriveUrl, falls back to snippetImageUrl
    signedPdfUrl,
    normalized: null, // Python service normalization status not exposed in SignedOcrResult yet
    needsReview,
    needsReviewReason, // Standardized: reason why review is needed (only when needsReview === true)
    sheetRowId,
    debug: {
      templateId: templateConfig.templateId,
      page,
    },
  };
}

