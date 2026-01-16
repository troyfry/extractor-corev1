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
import { findWorkOrderByWoNumber, isDbSignedLookupEnabled } from "./dbLookup";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { db } from "@/lib/db/drizzle";
import { signed_match, work_orders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { ingestSignedAuthoritative } from "@/lib/db/services/ingestSigned";

const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";
const MAIN_SHEET_NAME = process.env.GOOGLE_SHEETS_MAIN_SHEET_NAME || "Sheet1";
const SIGNED_DRIVE_FOLDER_NAME = process.env.GOOGLE_DRIVE_SIGNED_FOLDER_NAME || "Signed Work Orders";

export interface ProcessSignedPdfParams {
  pdfBytes: Buffer | Uint8Array;
  originalFilename?: string;
  page: number; // 1-based
  fmKey: string;
  spreadsheetId?: string | null; // Optional for DB-native mode
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
  if (!accessToken) {
    throw new Error("accessToken is required");
  }
  // spreadsheetId is optional (DB-native mode doesn't require it)
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

    // Write to DB first (authoritative)
    try {
      const workspaceId = await getWorkspaceIdForUser();
      if (workspaceId) {
        await ingestSignedAuthoritative({
          workspaceId,
          pdfBuffer,
          signedPdfUrl: signedPdfUrl || null,
          signedPreviewImageUrl: null,
          fmKey: normalizedFmKey,
          extractionResult: null,
          sourceMetadata: {
            messageId: sourceMeta?.gmailMessageId,
            attachmentId: sourceMeta?.gmailAttachmentId,
            gmailDate: sourceMeta?.gmailDate,
            source: source,
            gmailSubject: sourceMeta?.gmailSubject,
            gmailFrom: sourceMeta?.gmailFrom,
          },
        });
        console.log("[Signed Processor] ✅ Saved signed document to DB (needs review - no template)");
      }
    } catch (dbError) {
      console.error("[Signed Processor] Failed to save signed document to DB:", dbError);
      // Non-fatal - continue with Sheets write if available
    }

    // Write to Sheets only if spreadsheetId is provided (optional export)
    if (spreadsheetId) {
      try {
        await appendSignedNeedsReviewRow(accessToken, spreadsheetId, reviewRecord);
        console.log("[Signed Processor] ✅ Saved signed document to Sheets (needs review - no template)");
      } catch (sheetsError) {
        console.warn("[Signed Processor] Failed to save signed document to Sheets (non-fatal):", sheetsError);
      }
    }

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

  // Step 3: Call Python OCR service (with error handling for service unavailability)
  let ocrResult: SignedOcrResult;
  let ocrError: Error | null = null;
  
  try {
    ocrResult = await callSignedOcrService(pdfBuffer, originalFilename, {
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
      rawTextLength: ocrResult.rawText?.length || 0,
      rawTextPreview: ocrResult.rawText?.substring(0, 500) || null,
      snippetImageUrl: ocrResult.snippetImageUrl, // Show snippet image URL
    });
    
    // Log snippet URL (just URL, not content)
    if (ocrResult.snippetImageUrl) {
      const urlDisplay = ocrResult.snippetImageUrl.startsWith("data:") 
        ? "data:image/png;base64..." 
        : ocrResult.snippetImageUrl;
      console.log("📸 [Signed Processor] OCR snippet URL:", urlDisplay);
    } else {
      console.warn("⚠️ [Signed Processor] No snippet image URL from OCR service");
    }
  } catch (error) {
    // OCR service unavailable or failed - continue with fallback
    ocrError = error instanceof Error ? error : new Error(String(error));
    console.error("[Signed Processor] OCR service failed (continuing with fallback):", {
      error: ocrError.message,
      code: (error as any)?.cause?.code || (error as any)?.code || "UNKNOWN",
    });
    
    // Create fallback OCR result (no work order number, needs review)
    ocrResult = {
      woNumber: null,
      confidenceRaw: 0,
      confidenceLabel: "low",
      rawText: null,
      snippetImageUrl: null,
    };
    
    console.log("[Signed Processor] Using fallback OCR result (service unavailable):", {
      workOrderNumber: null,
      confidenceLabel: "low",
      note: "OCR service unavailable - document will be marked for review",
    });
  }

  // Step 4: Decide outcome
  // Priority: woNumberOverride > extractionResult > ocrResult
  let workOrderNumber: string | null = null;
  
  // Check if we have extraction result from 3-layer extraction (more accurate)
  if (params.extractionResult?.workOrderNumber) {
    workOrderNumber = params.extractionResult.workOrderNumber;
    console.log("[Signed Processor] Using work order number from 3-layer extraction:", {
      workOrderNumber,
      method: params.extractionResult.method,
      confidence: params.extractionResult.confidence,
      rationale: params.extractionResult.rationale,
    });
  } else if (ocrResult.woNumber) {
    workOrderNumber = ocrResult.woNumber;
    console.log("[Signed Processor] Using work order number from OCR result:", {
      workOrderNumber,
      confidence: ocrResult.confidenceRaw,
    });
  } else {
    console.warn("[Signed Processor] No work order number found:", {
      hasExtractionResult: !!params.extractionResult,
      extractionResultWoNumber: params.extractionResult?.workOrderNumber || null,
      ocrResultWoNumber: ocrResult.woNumber || null,
      ocrRawText: ocrResult.rawText?.substring(0, 500) || null,
    });
  }

  let needsReview: boolean;

  // If override provided, use it (highest priority)
  if (woNumberOverride) {
    workOrderNumber = woNumberOverride.trim();
    console.log("[Signed Processor] Using work order number override:", workOrderNumber);
  }

  // Check if work order exists (DB first if enabled, then fallback to Sheets)
  let workOrderExists = false;
  let workOrderAlreadySigned = false;
  let dbWorkOrderId: string | null = null;
  let dbLookupUsed = false;
  let fallbackUsed = false;

  // Check if DB signed lookup is enabled
  const dbLookupEnabled = isDbSignedLookupEnabled();
  console.log("[Signed Processor] DB lookup enabled:", dbLookupEnabled);

  if (workOrderNumber) {
    // Try DB lookup first if enabled
    if (dbLookupEnabled) {
      try {
        // Get workspace ID
        const workspaceId = await getWorkspaceIdForUser();
        if (workspaceId) {
          // Try to find work order in DB
          const dbWorkOrder = await findWorkOrderByWoNumber({
            workspaceId,
            workOrderNumber: workOrderNumber.trim(),
            // Note: fmProfileId not available here, but we can still search by wo_number
          });

          if (dbWorkOrder) {
            dbWorkOrderId = dbWorkOrder.work_order_id;
            workOrderExists = true;
            dbLookupUsed = true;
            console.log("[Signed Processor] DB match found: yes", {
              workOrderId: dbWorkOrderId,
              status: dbWorkOrder.status,
            });

            // Check if work order already has a signed_match (1:1 constraint)
            const [existingMatch] = await db
              .select()
              .from(signed_match)
              .where(eq(signed_match.work_order_id, dbWorkOrderId))
              .limit(1);

            if (existingMatch) {
              workOrderAlreadySigned = true;
              console.log("[Signed Processor] Work order already has signed document attached (1:1 constraint)");
            } else if (dbWorkOrder.status === "SIGNED") {
              // Also check if status is SIGNED (legacy check)
              workOrderAlreadySigned = true;
            }
          } else {
            console.log("[Signed Processor] DB match found: no");
            fallbackUsed = true;
          }
        }
      } catch (dbError) {
        // Non-fatal: fallback to Sheets lookup
        console.warn("[Signed Processor] DB lookup failed, falling back to Sheets:", dbError);
        fallbackUsed = true;
      }
    } else {
      fallbackUsed = true;
    }

    // Fallback to Sheets lookup if DB didn't find a match or DB lookup is disabled
    // Only if spreadsheetId is available (DB-native mode may not have Sheets)
    if (!workOrderExists && fallbackUsed && spreadsheetId) {
      console.log("[Signed Processor] Fallback used: yes (Sheets lookup)");
      const jobId = generateJobId(null, workOrderNumber);
      
      try {
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
      } catch (sheetsError) {
        // Non-fatal: Sheets lookup failed (spreadsheet may not exist in DB-native mode)
        console.warn("[Signed Processor] Sheets lookup failed (non-fatal, continuing):", {
          error: sheetsError instanceof Error ? sheetsError.message : String(sheetsError),
          note: "In DB-native mode, Sheets may not exist - this is expected",
        });
        // Continue without workOrderExists being set
      }
    } else if (!workOrderExists && fallbackUsed && !spreadsheetId) {
      console.log("[Signed Processor] Fallback skipped: no spreadsheetId (DB-native mode)");
    }
  }

  // Log instrumentation
  console.log("[Signed Processor] Lookup summary:", {
    dbLookupEnabled,
    dbLookupUsed,
    dbMatchFound: !!dbWorkOrderId,
    fallbackUsed,
    workOrderExists,
    workOrderAlreadySigned,
  });

  // Decide needsReview:
  // - If work order already signed with high confidence extraction → blocked (already processed)
  // - If work order already has a signed_match (1:1 constraint) → needs review with SIGNED_ALREADY_ATTACHED
  // - If no work order number OR low confidence → needs review
  // - If work order number but work order doesn't exist in sheets → needs review (original work order not found)
  // - If work order exists and (high/medium confidence OR override) → no review needed
  if (workOrderAlreadySigned) {
    // Check if it's because of 1:1 constraint (already has signed_match)
    let needsReviewReason = "Work order already processed (already signed)";
    let shouldNeedsReview = false;
    
    if (dbWorkOrderId) {
      // Check if it's specifically because of signed_match constraint
      const [existingMatch] = await db
        .select()
        .from(signed_match)
        .where(eq(signed_match.work_order_id, dbWorkOrderId))
        .limit(1);
      
      if (existingMatch) {
        needsReviewReason = "SIGNED_ALREADY_ATTACHED";
        shouldNeedsReview = true; // Route to NEEDS_REVIEW when 1:1 constraint prevents attachment
        console.log("[Signed Processor] Work order already has signed document attached (1:1 constraint enforced)");
      }
    }
    
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
      needsReview: shouldNeedsReview, // Needs review if 1:1 constraint blocked it
      needsReviewReason: needsReviewReason as any,
      alreadyProcessed: true,
      sheetRowId: null,
      debug: {
        templateId: templateConfig.templateId,
        page,
      },
    };
  }
  
  // Compute needsReviewReason early (standardized field for return value)
  let needsReviewReason: string | null = null;
  
  if (!workOrderNumber || ocrResult.confidenceLabel === "low") {
    needsReview = true;
    needsReviewReason = !workOrderNumber 
      ? "No work order number extracted" 
      : "Low confidence extraction";
  } else if (!workOrderExists) {
    needsReview = true; // Original work order not found
    needsReviewReason = "Original work order not found";
  } else {
    // Work order exists and we have a valid work order number
    needsReview = false;
    needsReviewReason = null;
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

  // needsReviewReason already computed above - use it or override with manualReason
  if (needsReview && manualReason) {
    needsReviewReason = manualReason;
  }

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

    // Write to DB first (authoritative)
    try {
      const workspaceId = await getWorkspaceIdForUser();
      if (workspaceId) {
        await ingestSignedAuthoritative({
          workspaceId,
          pdfBuffer,
          signedPdfUrl: signedPdfUrl || null,
          signedPreviewImageUrl: snippetDriveUrl || null,
          fmKey: normalizedFmKey,
          extractionResult: params.extractionResult || null,
          sourceMetadata: {
            messageId: sourceMeta?.gmailMessageId,
            attachmentId: sourceMeta?.gmailAttachmentId,
            gmailDate: sourceMeta?.gmailDate,
            source: source,
            gmailSubject: sourceMeta?.gmailSubject,
            gmailFrom: sourceMeta?.gmailFrom,
          },
        });
        console.log("[Signed Processor] ✅ Saved signed document to DB (needs review)");
      }
    } catch (dbError) {
      console.error("[Signed Processor] Failed to save signed document to DB:", dbError);
      // Non-fatal - continue with Sheets write if available
    }

    // Write to Sheets only if spreadsheetId is provided (optional export)
    if (spreadsheetId) {
      try {
        await appendSignedNeedsReviewRow(accessToken, spreadsheetId, reviewRecord);
        console.log("[Signed Processor] ✅ Saved signed document to Sheets (needs review)");
      } catch (sheetsError) {
        console.warn("[Signed Processor] Failed to save signed document to Sheets (non-fatal):", sheetsError);
      }
    }
    // Note: sheetRowId not available from appendSignedNeedsReviewRow
  } else {
    // Write to DB first (authoritative)
    try {
      const workspaceId = await getWorkspaceIdForUser();
      if (workspaceId && workOrderNumber) {
        await ingestSignedAuthoritative({
          workspaceId,
          pdfBuffer,
          signedPdfUrl: signedPdfUrl || null,
          signedPreviewImageUrl: snippetDriveUrl || null,
          fmKey: normalizedFmKey,
          extractionResult: params.extractionResult || null,
          sourceMetadata: {
            messageId: sourceMeta?.gmailMessageId,
            attachmentId: sourceMeta?.gmailAttachmentId,
            gmailDate: sourceMeta?.gmailDate,
            source: source,
            gmailSubject: sourceMeta?.gmailSubject,
            gmailFrom: sourceMeta?.gmailFrom,
          },
          workOrderNumber: workOrderNumber, // This will match the work order
        });
        console.log("[Signed Processor] ✅ Saved signed document to DB (matched)");
      }
    } catch (dbError) {
      console.error("[Signed Processor] Failed to save signed document to DB:", dbError);
      // Non-fatal - continue with Sheets write if available
    }

    // Update Work Orders sheet - ONLY update status and signed fields (optional export)
    // All other data was already extracted at upload time (one and done)
    if (workOrderNumber && spreadsheetId) {
      try {
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
        
        console.log(`[Signed Processor] ✅ Updated work order status to SIGNED in Sheets: ${jobId}`);

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
      } catch (sheetsError) {
        console.warn("[Signed Processor] Failed to update Sheets (non-fatal):", sheetsError);
      }
    }
  }

  // Step 6: Return standardized result
  // snippetUrl: prefer snippetDriveUrl (uploaded to Drive), fall back to snippetImageUrl (data URL from OCR)
  const snippetUrl = snippetDriveUrl || ocrResult.snippetImageUrl || null;

  // Log snippet URLs (just URLs, not content)
  if (snippetUrl || snippetDriveUrl || ocrResult.snippetImageUrl) {
    console.log("📸 [Signed Processor] Snippet URLs:", {
      snippetImageUrl: ocrResult.snippetImageUrl ? (ocrResult.snippetImageUrl.startsWith("data:") ? "data:image/png;base64..." : ocrResult.snippetImageUrl) : null,
      snippetDriveUrl: snippetDriveUrl || null,
      snippetUrl: snippetUrl || null,
    });
  }

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

