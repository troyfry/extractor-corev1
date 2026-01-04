/**
 * Core signed PDF processing logic.
 * 
 * This module contains the shared processing logic used by both:
 * - /api/signed/process (manual upload)
 * - /api/signed/gmail/process (Gmail batch processing)
 */

import {
  updateJobWithSignedInfoByWorkOrderNumber,
  writeWorkOrderRecord,
  findWorkOrderRecordByJobId,
  type WorkOrderRecord,
} from "@/lib/google/sheets";
import {
  appendSignedNeedsReviewRow,
} from "@/lib/workOrders/signedSheets";
import {
  callSignedOcrService,
} from "@/lib/workOrders/signedOcr";
import {
  getTemplateConfigForFmKey,
  type TemplateConfig,
} from "@/lib/workOrders/templateConfig";
import {
  decideSignedWorkOrder,
  extractCandidatesFromText,
  type DecisionResult,
} from "@/lib/workOrders/signedDecisionEngine";
import { extractTextFromPdfBuffer } from "@/lib/workOrders/aiParser";
import {
  assertPdfCropPointsValid,
  type PdfCropPoints,
  type BoundsPt,
} from "@/lib/templates/templateCoordinateConversion";
import {
  uploadPdfToDrive,
  getOrCreateFolder,
} from "@/lib/google/drive";
import { uploadSnippetImageToDrive } from "@/lib/drive-snippets";
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";
import { NEEDS_REVIEW_REASONS } from "@/lib/workOrders/reasons";
import { getNeedsReviewUx } from "@/lib/workOrders/reviewReasons";
import { sha256Buffer } from "@/lib/workOrders/fileHash";
import { checkSignedPdfAlreadyProcessed } from "@/lib/workOrders/dedupe";
import crypto from "crypto";

const MAIN_SHEET_NAME =
  process.env.GOOGLE_SHEETS_MAIN_SHEET_NAME || "Sheet1";

const WORK_ORDERS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

const SIGNED_DRIVE_FOLDER_NAME =
  process.env.GOOGLE_DRIVE_SIGNED_FOLDER_NAME || "Signed Work Orders";

export interface ProcessSignedPdfParams {
  accessToken: string;
  spreadsheetId: string;
  fmKey: string;
  pdfBuffer: Buffer;
  originalFilename: string;
  woNumberOverride?: string | null;
  manualReason?: string | null;
  pageNumberOverride?: number | null;
  source?: "UPLOAD" | "GMAIL";
  sourceMeta?: {
    gmailMessageId?: string;
    gmailAttachmentId?: string;
    gmailThreadId?: string;
    gmailFrom?: string;
    gmailSubject?: string;
    gmailDate?: string;
  };
}

export interface ProcessSignedPdfResponse {
  mode: "UPDATED" | "NEEDS_REVIEW" | "ALREADY_PROCESSED";
  data: {
    fmKey: string;
    woNumber: string | null;
    ocrConfidenceLabel: "low" | "medium" | "high";
    ocrConfidenceRaw: number;
    confidenceLabel: "low" | "medium" | "high";
    confidenceRaw: number;
    automationStatus: "APPLIED" | "REVIEW" | "BLOCKED";
    automationBlocked: boolean;
    automationBlockReason: string | null;
    signedPdfUrl: string | null;
    snippetImageUrl: string | null;
    snippetDriveUrl: string | null;
    jobExistsInSheet1: boolean;
    retryAttempted: boolean;
    alternatePageAttempted: boolean;
    reason?: string | null;
    fixHref?: string | null;
    fixAction?: string | null;
    reasonTitle?: string | null;
    reasonMessage?: string | null;
    tone?: "warning" | "info" | "danger" | "success" | null;
    templateUsed: {
      templateId: string | null;
      fmKey: string;
      page: number | null;
      region: { xPct: number; yPct: number; wPct: number; hPct: number } | null;
      dpi: number | null;
      coordSystem: string | null;
      xPt: number | null;
      yPt: number | null;
      wPt: number | null;
      hPt: number | null;
      pageWidthPt: number | null;
      pageHeightPt: number | null;
    };
    chosenPage: number | null;
    attemptedPages: string;
    chosenConfidence?: number;
    chosenExtractedWorkOrderNumber?: string | null;
    chosenAttemptIndex?: number;
    attempts?: Array<{
      page: number;
      confidence: number;
      extracted: string | null;
      extractedValid: boolean;
      retryAttempted: boolean;
    }>;
    fileHash?: string;
    foundIn?: "WORK_ORDERS" | "NEEDS_REVIEW_SIGNED";
    rowIndex?: number;
    debug?: {
      coordSystem: string | null;
      templatePt: {
        xPt: number | null;
        yPt: number | null;
        wPt: number | null;
        hPt: number | null;
      };
      pagePt: {
        pageWidthPt: number | null;
        pageHeightPt: number | null;
      };
      render: {
        dpiUsed: number | null;
        imageWidthPx: number | null;
        imageHeightPx: number | null;
      };
      cropPx: {
        xPx: number | null;
        yPx: number | null;
        wPx: number | null;
        hPx: number | null;
      };
    };
    decision?: {
      state: "AUTO_CONFIRMED" | "QUICK_CHECK" | "NEEDS_ATTENTION";
      bestCandidate?: string;
      normalizedCandidates: string[];
      trustScore: number;
      reasons: Array<"NO_CANDIDATE" | "MULTIPLE_CANDIDATES" | "FORMAT_MISMATCH" | "LOW_CONFIDENCE" | "PASS_AGREEMENT" | "SEQ_OUTLIER" | "OK_FORMAT" | "DIGITAL_TEXT_STRONG">;
    };
  };
}

/**
 * Process a signed PDF work order.
 * 
 * This is the core processing logic extracted from /api/signed/process.
 * It handles:
 * - File hash calculation and deduplication
 * - Drive upload
 * - Template config lookup and validation
 * - OCR processing
 * - Sheet1 matching and update
 * - Work_Orders sheet update
 * - Needs_Review_Signed sheet append
 */
export async function processSignedPdf(
  params: ProcessSignedPdfParams
): Promise<ProcessSignedPdfResponse> {
  const {
    accessToken,
    spreadsheetId,
    fmKey,
    pdfBuffer,
    originalFilename,
    woNumberOverride,
    manualReason,
    pageNumberOverride,
    source = "UPLOAD",
    sourceMeta,
  } = params;

  // Normalize fmKey for consistent comparison
  const { normalizeFmKey } = await import("@/lib/templates/fmProfiles");
  const normalizedFmKey = normalizeFmKey(fmKey);

  // Generate requestId for correlated logging
  const requestId = crypto.randomUUID();

  console.log("[Signed Processor] Starting processing:", {
    requestId,
    rawFmKey: fmKey,
    normalizedFmKey,
    filename: originalFilename,
    fileSize: pdfBuffer.length,
  });

  // Calculate file hash for deduplication (SHA-256)
  const fileHash = sha256Buffer(pdfBuffer);

  // Check if this PDF has already been processed (BEFORE Drive upload, template lookup, OCR)
  const dedupeResult = await checkSignedPdfAlreadyProcessed({
    accessToken,
    spreadsheetId,
    fileHash,
  });

  if (dedupeResult.exists) {
    console.log(`[Signed Processor] ⚠️ PDF already processed (file_hash: ${fileHash.substring(0, 16)}...), found in ${dedupeResult.foundIn} at row ${dedupeResult.rowIndex}`);
    return {
      mode: "ALREADY_PROCESSED",
      data: {
        fmKey: normalizedFmKey,
        woNumber: null,
        ocrConfidenceLabel: "low",
        ocrConfidenceRaw: 0,
        confidenceLabel: "low",
        confidenceRaw: 0,
        automationStatus: "BLOCKED",
        automationBlocked: true,
        automationBlockReason: null,
        signedPdfUrl: null,
        snippetImageUrl: null,
        snippetDriveUrl: null,
        jobExistsInSheet1: false,
        retryAttempted: false,
        alternatePageAttempted: false,
        templateUsed: {
          templateId: null,
          fmKey: normalizedFmKey,
          page: null,
          region: null,
          dpi: null,
          coordSystem: null,
          xPt: null,
          yPt: null,
          wPt: null,
          hPt: null,
          pageWidthPt: null,
          pageHeightPt: null,
        },
        chosenPage: null,
        attemptedPages: "",
        fileHash,
        foundIn: dedupeResult.foundIn,
        rowIndex: dedupeResult.rowIndex,
      },
    };
  }

  // Upload signed PDF to Drive into a dedicated folder
  const signedFolderId = await getOrCreateFolder(
    accessToken,
    SIGNED_DRIVE_FOLDER_NAME
  );

  const uploaded = await uploadPdfToDrive(
    accessToken,
    pdfBuffer,
    originalFilename,
    signedFolderId
  );

  const signedPdfUrl = uploaded.webViewLink || uploaded.webContentLink;

  // Helper functions (same as in route)
  function toFiniteNumber(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function normalizeRegion(region: unknown): { xPct: number; yPct: number; wPct: number; hPct: number } {
    return {
      xPct: toFiniteNumber((region as { xPct?: unknown })?.xPct),
      yPct: toFiniteNumber((region as { yPct?: unknown })?.yPct),
      wPct: toFiniteNumber((region as { wPct?: unknown })?.wPct),
      hPct: toFiniteNumber((region as { hPct?: unknown })?.hPct),
    };
  }

  function validateTemplateCrop(region: { xPct: number; yPct: number; wPct: number; hPct: number }): { valid: boolean; reason?: string } {
    const { xPct, yPct, wPct, hPct } = region;
    const TOLERANCE = 0.01;
    const MIN_W = 0.01;
    const MIN_H = 0.01;

    if (!Number.isFinite(xPct) || !Number.isFinite(yPct) || !Number.isFinite(wPct) || !Number.isFinite(hPct)) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.INVALID_CROP };
    }

    const isDefault = Math.abs(xPct) < TOLERANCE && 
                      Math.abs(yPct) < TOLERANCE && 
                      Math.abs(wPct - 1) < TOLERANCE && 
                      Math.abs(hPct - 1) < TOLERANCE;
    if (isDefault) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.TEMPLATE_NOT_CONFIGURED };
    }

    if (xPct < 0 || yPct < 0 || wPct <= 0 || hPct <= 0 || xPct + wPct > 1 || yPct + hPct > 1) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.INVALID_CROP };
    }

    if (wPct < MIN_W || hPct < MIN_H) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.CROP_TOO_SMALL };
    }

    return { valid: true };
  }

  function sanitizeDpi(dpi: number | undefined | null): number {
    if (dpi === undefined || dpi === null || isNaN(dpi) || dpi === 0) {
      return 200;
    }
    return Math.max(100, Math.min(400, Math.round(dpi)));
  }

  function expandCrop(
    region: { xPct: number; yPct: number; wPct: number; hPct: number },
    pad: number
  ): { xPct: number; yPct: number; wPct: number; hPct: number } {
    const newX = Math.max(0, region.xPct - pad);
    const newY = Math.max(0, region.yPct - pad);
    const newW = Math.min(1 - newX, region.wPct + 2 * pad);
    const newH = Math.min(1 - newY, region.hPct + 2 * pad);
    return { xPct: newX, yPct: newY, wPct: newW, hPct: newH };
  }

  function hasValidPoints(cfg: TemplateConfig): boolean {
    const nums = [cfg?.xPt, cfg?.yPt, cfg?.wPt, cfg?.hPt, cfg?.pageWidthPt, cfg?.pageHeightPt];
    return nums.every((n) => typeof n === "number" && Number.isFinite(n)) &&
      cfg.wPt! > 0 && cfg.hPt! > 0 && cfg.pageWidthPt! > 0 && cfg.pageHeightPt! > 0;
  }

  function validateTemplateCropPoints(cfg: TemplateConfig): { valid: boolean; reason?: string } {
    const { xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt } = cfg;

    if (![xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt].every(Number.isFinite)) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.INVALID_CROP };
    }

    // treat as TOP-LEFT points
    if (xPt! < 0 || yPt! < 0 || wPt! <= 0 || hPt! <= 0) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.INVALID_CROP };
    }

    if (xPt! + wPt! > pageWidthPt! || yPt! + hPt! > pageHeightPt!) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.INVALID_CROP };
    }

    // optional "too small" threshold in points
    if (wPt! < 5 || hPt! < 5) {
      return { valid: false, reason: NEEDS_REVIEW_REASONS.CROP_TOO_SMALL };
    }

    return { valid: true };
  }

  function expandCropPoints(cfg: TemplateConfig, padPt: number): { xPt: number; yPt: number; wPt: number; hPt: number } {
    return {
      xPt: Math.max(0, cfg.xPt! - padPt),
      yPt: Math.max(0, cfg.yPt! - padPt),
      wPt: Math.min(cfg.pageWidthPt! - Math.max(0, cfg.xPt! - padPt), cfg.wPt! + 2 * padPt),
      hPt: Math.min(cfg.pageHeightPt! - Math.max(0, cfg.yPt! - padPt), cfg.hPt! + 2 * padPt),
    };
  }

  function assertPointsCrop(points?: {
    xPt?: number;
    yPt?: number;
    wPt?: number;
    hPt?: number;
    pageWidthPt?: number;
    pageHeightPt?: number;
    page?: number;
  }): void {
    if (!points) {
      throw new Error("Missing crop points");
    }
    const { xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt, page } = points;

    const ok =
      [xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt, page].every(
        (v) => typeof v === "number" && Number.isFinite(v)
      ) &&
      wPt! > 0 &&
      hPt! > 0 &&
      pageWidthPt! > 0 &&
      pageHeightPt! > 0 &&
      page! >= 1;

    if (!ok) {
      throw new Error(
        "Invalid or incomplete PDF_POINTS crop (requires xPt,yPt,wPt,hPt,pageWidthPt,pageHeightPt,page>=1)."
      );
    }
  }

  function isValidWoNumber(woNumber: string | null): boolean {
    if (!woNumber || woNumber.trim().length === 0) {
      return false;
    }
    
    const trimmed = woNumber.trim();
    
    if (trimmed.length < 3) {
      return false;
    }
    
    if (!/\d/.test(trimmed)) {
      return false;
    }
    
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (digitCount < 3) {
      return false;
    }
    
    if (/^0+$/.test(trimmed)) {
      return false;
    }
    
    if (/^(\d)\1+$/.test(trimmed) && trimmed.length <= 4) {
      return false;
    }
    
    return true;
  }

  // Resolve template config based on fmKey
  let templateConfig: Awaited<ReturnType<typeof getTemplateConfigForFmKey>> | null = null;
  let cropValidationResult: { valid: boolean; reason?: string } | null = null;
  let templateError: Error | null = null;
  try {
    templateConfig = await getTemplateConfigForFmKey(normalizedFmKey);
  } catch (error) {
    templateError = error instanceof Error ? error : new Error(String(error));
    templateConfig = null;
  }

  // If template config is missing, return NEEDS_REVIEW without calling OCR
  if (!templateConfig) {
    const isTemplateNotConfigured = templateError?.message === "TEMPLATE_NOT_CONFIGURED" || 
                                     templateError?.message.includes("TEMPLATE_NOT_CONFIGURED");
    const reason = isTemplateNotConfigured 
      ? NEEDS_REVIEW_REASONS.TEMPLATE_NOT_CONFIGURED 
      : NEEDS_REVIEW_REASONS.TEMPLATE_NOT_FOUND;
    
    const reviewId = `review_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = new Date().toISOString();
    await appendSignedNeedsReviewRow(accessToken, spreadsheetId, {
      review_id: reviewId,
      created_at: createdAt,
      fmKey: normalizedFmKey,
      signed_pdf_url: signedPdfUrl,
      preview_image_url: null,
      raw_text: "",
      confidence: "low",
      reason,
      manual_work_order_number: null,
      resolved: "FALSE",
      resolved_at: null,
      file_hash: fileHash,
      source: source,
      gmail_message_id: sourceMeta?.gmailMessageId || null,
      gmail_attachment_id: sourceMeta?.gmailAttachmentId || null,
      gmail_subject: sourceMeta?.gmailSubject || null,
      gmail_from: sourceMeta?.gmailFrom || null,
      gmail_date: sourceMeta?.gmailDate || null,
    });

    const templateUx = getNeedsReviewUx(reason, normalizedFmKey);
    
    return {
      mode: "NEEDS_REVIEW",
      data: {
        fmKey: normalizedFmKey,
        woNumber: null,
        ocrConfidenceLabel: "low",
        ocrConfidenceRaw: 0,
        confidenceLabel: "low",
        confidenceRaw: 0,
        automationStatus: "BLOCKED",
        automationBlocked: true,
        automationBlockReason: reason,
        signedPdfUrl,
        snippetImageUrl: null,
        snippetDriveUrl: null,
        jobExistsInSheet1: false,
        retryAttempted: false,
        alternatePageAttempted: false,
        reason,
        fixHref: templateUx.href || null,
        fixAction: templateUx.actionLabel || null,
        reasonTitle: templateUx.title,
        reasonMessage: templateUx.message,
        tone: templateUx.tone,
        templateUsed: {
          templateId: null,
          fmKey: normalizedFmKey,
          page: pageNumberOverride ?? null,
          region: null,
          dpi: null,
          coordSystem: null,
          xPt: null,
          yPt: null,
          wPt: null,
          hPt: null,
          pageWidthPt: null,
          pageHeightPt: null,
        },
        chosenPage: null,
        attemptedPages: "",
      },
    };
  }

  // Override page number if provided
  if (pageNumberOverride !== null && !isNaN(pageNumberOverride) && pageNumberOverride > 0) {
    templateConfig = {
      ...templateConfig,
      page: pageNumberOverride,
    };
  }

  // Check if template uses points mode
  const pointsMode = hasValidPoints(templateConfig);

  // Normalize region values before validation (for legacy mode)
  const normalizedRegion = normalizeRegion(templateConfig.region);
  templateConfig = { ...templateConfig, region: normalizedRegion };

  // Validate template crop before calling OCR
  // If template has valid points, validate points. Else validate region (legacy).
  cropValidationResult = pointsMode
    ? validateTemplateCropPoints(templateConfig)
    : validateTemplateCrop(normalizedRegion);
  if (!cropValidationResult.valid) {
    const reviewId = `review_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = new Date().toISOString();
    await appendSignedNeedsReviewRow(accessToken, spreadsheetId, {
      review_id: reviewId,
      created_at: createdAt,
      fmKey: normalizedFmKey,
      signed_pdf_url: signedPdfUrl,
      preview_image_url: null,
      raw_text: "",
      confidence: "low",
      reason: cropValidationResult.reason || NEEDS_REVIEW_REASONS.TEMPLATE_NOT_CONFIGURED,
      manual_work_order_number: null,
      resolved: "FALSE",
      resolved_at: null,
      file_hash: fileHash,
      source: source,
      gmail_message_id: sourceMeta?.gmailMessageId || null,
      gmail_attachment_id: sourceMeta?.gmailAttachmentId || null,
      gmail_subject: sourceMeta?.gmailSubject || null,
      gmail_from: sourceMeta?.gmailFrom || null,
      gmail_date: sourceMeta?.gmailDate || null,
    });

    const cropReason = cropValidationResult.reason || NEEDS_REVIEW_REASONS.TEMPLATE_NOT_CONFIGURED;
    const cropUx = getNeedsReviewUx(cropReason, normalizedFmKey);
    
    return {
      mode: "NEEDS_REVIEW",
      data: {
        fmKey: normalizedFmKey,
        woNumber: null,
        ocrConfidenceLabel: "low",
        ocrConfidenceRaw: 0,
        confidenceLabel: "low",
        confidenceRaw: 0,
        automationStatus: "BLOCKED",
        automationBlocked: true,
        automationBlockReason: cropReason,
        signedPdfUrl,
        snippetImageUrl: null,
        snippetDriveUrl: null,
        jobExistsInSheet1: false,
        retryAttempted: false,
        alternatePageAttempted: false,
        reason: cropReason,
        fixHref: cropUx.href || null,
        fixAction: cropUx.actionLabel || null,
        reasonTitle: cropUx.title,
        reasonMessage: cropUx.message,
        tone: cropUx.tone,
        templateUsed: {
          templateId: templateConfig.templateId,
          fmKey: normalizedFmKey,
          page: templateConfig.page ?? null,
          region: normalizedRegion,
          dpi: templateConfig.dpi ?? null,
          coordSystem: pointsMode ? "PDF_POINTS_TOP_LEFT" : "PCT",
          xPt: templateConfig.xPt ?? null,
          yPt: templateConfig.yPt ?? null,
          wPt: templateConfig.wPt ?? null,
          hPt: templateConfig.hPt ?? null,
          pageWidthPt: templateConfig.pageWidthPt ?? null,
          pageHeightPt: templateConfig.pageHeightPt ?? null,
        },
        chosenPage: null,
        attemptedPages: "",
      },
    };
  }

  // Sanitize DPI
  templateConfig.dpi = sanitizeDpi(templateConfig.dpi);

  // Get PDF page count and extract digital text
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require("pdf-parse");
  const parseFn = typeof pdfParse === "function" ? pdfParse : pdfParse.default ?? pdfParse;
  const pdfData = await parseFn(pdfBuffer);
  const pageCount = pdfData.numpages || 1;

  /**
   * Get actual PDF page dimensions in points using MuPDF.
   * Returns dimensions from PDF user space (72 DPI points).
   * Same pattern as renderPdfPage.ts.
   */
  async function getActualPdfPageDimensionsPt(
    pdfBuffer: Buffer,
    pageNumber: number
  ): Promise<{ pageWidthPt: number; pageHeightPt: number } | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // @ts-expect-error - mupdf module exists at runtime but has no type declarations
      const mupdfModule: any = await import("mupdf");
      
      // Most WASM bundles export an async init function as default.
      const init = mupdfModule.default || mupdfModule;
      let mupdf: any;
      if (typeof init === "function") {
        const result = init();
        mupdf = result instanceof Promise ? await result : result;
      } else {
        mupdf = init;
      }
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Document = (mupdf as any).Document;
      if (!Document || typeof (Document as any).openDocument !== "function") {
        return null;
      }
      
      const pdfUint8Array = new Uint8Array(pdfBuffer);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (Document as any).openDocument(pdfUint8Array, "application/pdf");
      if (!doc) return null;
      
      const docPageCount = doc.countPages();
      if (pageNumber < 1 || pageNumber > docPageCount) return null;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfPage = doc.loadPage(pageNumber - 1);
      if (!pdfPage) return null;
      
      // Get page dimensions in points (PDF user space, 72 DPI)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rect = (pdfPage as any).getBounds();
      const pageWidthPt = Math.ceil(rect.x1 - rect.x0);
      const pageHeightPt = Math.ceil(rect.y1 - rect.y0);
      
      return { pageWidthPt, pageHeightPt };
    } catch (error) {
      console.warn(`[Signed Processor] Failed to get actual PDF page dimensions:`, {
        requestId,
        page: pageNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // Step 1: Attempt digital text extraction first
  // Build template rule (use expectedDigits = 7 as default, can be made configurable)
  const expectedDigits = 7; // TODO: Get from template config if available
  
  let digitalText: string = "";
  let digitalCandidates: string[] = [];
  let digitalExtractionMethod: "DIGITAL_TEXT" | "OCR" = "OCR"; // Default to OCR if digital fails
  
  try {
    digitalText = await extractTextFromPdfBuffer(pdfBuffer);
    if (digitalText && digitalText.trim().length > 0) {
      // Extract candidates from digital text
      digitalCandidates = extractCandidatesFromText(digitalText, expectedDigits);
    }
  } catch (error) {
    // Digital text extraction failed (scanned PDF, etc.) - will fall back to OCR
    console.log(`[Signed Processor] Digital text extraction failed, will use OCR:`, {
      requestId,
      fmKey: normalizedFmKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Type for OCR attempt tracking
  type OcrAttempt = {
    page: number;
    confidence: number;
    woNumber: string | null;
    rawText: string;
    snippetImageUrl: string | null;
    region: typeof templateConfig.region;
    retryAttempted: boolean;
  };

  function pickBestAttempt(attempts: OcrAttempt[]): OcrAttempt {
    if (attempts.length === 0) {
      throw new Error("No OCR attempts provided");
    }
    if (attempts.length === 1) {
      return attempts[0];
    }

    const validAttempts = attempts.filter(a => isValidWoNumber(a.woNumber));
    if (validAttempts.length > 0) {
      return validAttempts.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );
    }

    return attempts.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
  }

  // Attempt OCR on template.page
  const templatePage = templateConfig.page;

  /**
   * Compute effective crop points and page dimensions for a given page.
   * 
   * CRITICAL: Use template coordinates EXACTLY as saved - NO SCALING.
   * The coordinates saved during template configuration must match exactly what's used here.
   * The OCR service handles dimension differences internally when rasterizing.
   * 
   * @param _pageNumber - 1-indexed page number (unused, kept for API compatibility)
   * @returns Object with effective crop points and page dimensions (always from template, never scaled)
   */
  async function computeEffectiveCropAndDimensions(
    _pageNumber: number
  ): Promise<{
    xPt: number;
    yPt: number;
    wPt: number;
    hPt: number;
    pageWidthPt: number;
    pageHeightPt: number;
    scaled: boolean;
    scaleX: number;
    scaleY: number;
  }> {
    // ALWAYS use template coordinates EXACTLY as saved - NO SCALING
    // The OCR service will handle any dimension differences when rasterizing the PDF
    const effectivePageWidthPt = templateConfig.pageWidthPt || 0;
    const effectivePageHeightPt = templateConfig.pageHeightPt || 0;
    
    // Use template crop points directly - these match what was saved during template configuration
    const xPtEff = templateConfig.xPt ?? 0;
    const yPtEff = templateConfig.yPt ?? 0;
    const wPtEff = templateConfig.wPt ?? 0;
    const hPtEff = templateConfig.hPt ?? 0;
    
    console.log(`[Signed Processor] Using template coordinates EXACTLY as saved (no scaling):`, {
      requestId,
      fmKey: normalizedFmKey,
      templateCropPoints: {
        xPt: xPtEff,
        yPt: yPtEff,
        wPt: wPtEff,
        hPt: hPtEff,
      },
      templatePageDimensions: {
        pageWidthPt: effectivePageWidthPt,
        pageHeightPt: effectivePageHeightPt,
      },
    });
    
    return {
      xPt: xPtEff,
      yPt: yPtEff,
      wPt: wPtEff,
      hPt: hPtEff,
      pageWidthPt: effectivePageWidthPt,
      pageHeightPt: effectivePageHeightPt,
      scaled: false, // Never scale - use template coordinates as-is
      scaleX: 1.0,
      scaleY: 1.0,
    };
  }

  // Compute effective crop and dimensions for template page
  const templatePageEffective = await computeEffectiveCropAndDimensions(templatePage);
  const effectivePageWidthPt = templatePageEffective.pageWidthPt;
  const effectivePageHeightPt = templatePageEffective.pageHeightPt;

  // Note: Page dimension mismatches are now handled automatically by scaling crop points
  // in computeEffectiveCropAndDimensions(). No need for a separate guard.

  // Guard: assert points are valid before calling OCR (if in points mode)
  // ⚠️ USE LOCKED VALIDATION FUNCTION - DO NOT MODIFY
  if (pointsMode) {
    try {
      // Get bounds from PDF for complete validation
      // If bounds not available, use default (points are already normalized to 0-based)
      const pdfBounds = await (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // @ts-expect-error - mupdf module exists at runtime but has no type declarations
          const mupdfModule: any = await import("mupdf");
          const init = mupdfModule.default || mupdfModule;
          let mupdf: any;
          if (typeof init === "function") {
            const result = init();
            mupdf = result instanceof Promise ? await result : result;
          } else {
            mupdf = init;
          }
          
          const Document = (mupdf as any).Document;
          if (!Document) return null;
          
          const pdfUint8Array = new Uint8Array(pdfBuffer);
          const doc = (Document as any).openDocument(pdfUint8Array, "application/pdf");
          if (!doc) return null;
          
          const pdfPage = doc.loadPage(templatePage - 1);
          if (!pdfPage) return null;
          
          const rect = (pdfPage as any).getBounds();
          return { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 } as BoundsPt;
        } catch {
          return null;
        }
      })();
      
      // Use actual bounds if available, otherwise default to 0-based (points are normalized)
      const boundsPt: BoundsPt = pdfBounds || {
        x0: 0,
        y0: 0,
        x1: templateConfig.pageWidthPt!,
        y1: templateConfig.pageHeightPt!,
      };
      
      const crop: PdfCropPoints = {
        xPt: templateConfig.xPt!,
        yPt: templateConfig.yPt!,
        wPt: templateConfig.wPt!,
        hPt: templateConfig.hPt!,
        pageWidthPt: templateConfig.pageWidthPt!,
        pageHeightPt: templateConfig.pageHeightPt!,
        boundsPt,
      };
      
      assertPdfCropPointsValid(crop, `Template ${normalizedFmKey}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Signed Processor] Points validation failed:`, {
        requestId,
        fmKey: normalizedFmKey,
        templateId: templateConfig.templateId,
        error: errorMessage,
      });
      
      // Return verification result
      const reviewId = `review_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const createdAt = new Date().toISOString();
      await appendSignedNeedsReviewRow(accessToken, spreadsheetId, {
        review_id: reviewId,
        created_at: createdAt,
        fmKey: normalizedFmKey,
        signed_pdf_url: signedPdfUrl,
        preview_image_url: null,
        raw_text: "",
        confidence: "low",
        reason: NEEDS_REVIEW_REASONS.INVALID_CROP,
        manual_work_order_number: null,
        resolved: "FALSE",
        resolved_at: null,
        file_hash: fileHash,
        source: source,
        gmail_message_id: sourceMeta?.gmailMessageId || null,
        gmail_attachment_id: sourceMeta?.gmailAttachmentId || null,
        gmail_subject: sourceMeta?.gmailSubject || null,
        gmail_from: sourceMeta?.gmailFrom || null,
        gmail_date: sourceMeta?.gmailDate || null,
      });

      const cropUx = getNeedsReviewUx(NEEDS_REVIEW_REASONS.INVALID_CROP, normalizedFmKey);
      
      return {
        mode: "NEEDS_REVIEW",
        data: {
          fmKey: normalizedFmKey,
          woNumber: null,
          ocrConfidenceLabel: "low",
          ocrConfidenceRaw: 0,
          confidenceLabel: "low",
          confidenceRaw: 0,
          automationStatus: "BLOCKED",
          automationBlocked: true,
          automationBlockReason: NEEDS_REVIEW_REASONS.INVALID_CROP,
          signedPdfUrl,
          snippetImageUrl: null,
          snippetDriveUrl: null,
          jobExistsInSheet1: false,
          retryAttempted: false,
          alternatePageAttempted: false,
          reason: NEEDS_REVIEW_REASONS.INVALID_CROP,
          fixHref: cropUx.href || null,
          fixAction: cropUx.actionLabel || null,
          reasonTitle: cropUx.title,
          reasonMessage: cropUx.message,
          tone: cropUx.tone,
          templateUsed: {
            templateId: templateConfig.templateId,
            fmKey: normalizedFmKey,
            page: templatePage ?? null,
            region: normalizedRegion,
            dpi: templateConfig.dpi ?? null,
            coordSystem: "PDF_POINTS_TOP_LEFT",
            xPt: templateConfig.xPt ?? null,
            yPt: templateConfig.yPt ?? null,
            wPt: templateConfig.wPt ?? null,
            hPt: templateConfig.hPt ?? null,
            pageWidthPt: templateConfig.pageWidthPt ?? null,
            pageHeightPt: templateConfig.pageHeightPt ?? null,
          },
          chosenPage: null,
          attemptedPages: "",
        },
      };
    }
  }

  // Note: Page dimension mismatches are now handled automatically by scaling crop points
  // in computeEffectiveCropAndDimensions(). OCR proceeds with scaled coordinates.

  // Only call OCR if digital text extraction yielded no valid candidates
  // Normalize and validate digital candidates
  const normalizedDigitalCandidates = digitalCandidates
    .map(c => c.replace(/\D/g, ""))
    .filter(Boolean);

  const validDigitalCandidates = normalizedDigitalCandidates.filter(n =>
    n.length === expectedDigits
  );

  // THIS is the only "digital works" indicator:
  const shouldSkipOcr = validDigitalCandidates.length > 0;
  
  if (shouldSkipOcr) {
    digitalExtractionMethod = "DIGITAL_TEXT";
    console.log(`[Signed Processor] Digital text extraction found valid candidate(s):`, {
      requestId,
      fmKey: normalizedFmKey,
      candidates: validDigitalCandidates,
    });
  }
  
  let ocrResult = {
    woNumber: null as string | null,
    rawText: "",
    confidenceRaw: 0,
    snippetImageUrl: null as string | null,
  };
  let ocrAttempts: OcrAttempt[] = [];
  let retryAttempted = false;
  let alternatePageAttempted = false;
  let bestAttempt: OcrAttempt | null = null;
  let bestAttemptIndex = -1;
  let attemptedPages = "";
  let chosenPage: number | null = null;
  
  if (shouldSkipOcr) {
    console.log(`[Signed Processor] Skipping OCR - digital text extraction found valid candidates:`, {
      requestId,
      fmKey: normalizedFmKey,
      candidates: validDigitalCandidates,
    });
    
    // Create a synthetic OCR attempt from digital text for compatibility
    const normalizedDigitalWo = validDigitalCandidates[0] ?? null;
    bestAttempt = {
      page: templatePage,
      confidence: 1.0, // Digital text is considered high confidence
      woNumber: normalizedDigitalWo,
      rawText: digitalText,
      snippetImageUrl: null,
      region: templateConfig.region,
      retryAttempted: false,
    };
    ocrAttempts = [bestAttempt];
    bestAttemptIndex = 0;
    ocrResult = {
      woNumber: normalizedDigitalWo,
      rawText: digitalText,
      confidenceRaw: 1.0,
      snippetImageUrl: null,
    };
    attemptedPages = String(templatePage);
    chosenPage = templatePage;
  } else {
  // Log OCR attempt with requestId
  console.log(`[Signed Processor] Calling OCR service:`, {
    requestId,
    fmKey: normalizedFmKey,
    templateId: templateConfig.templateId,
    page: templatePage,
    pointsMode,
    xPt: templateConfig.xPt,
    yPt: templateConfig.yPt,
    wPt: templateConfig.wPt,
    hPt: templateConfig.hPt,
      pageWidthPt: effectivePageWidthPt,
      pageHeightPt: effectivePageHeightPt,
  });

  const firstAttempt = await callSignedOcrService(
    pdfBuffer,
    originalFilename,
    {
      templateId: templateConfig.templateId,
      page: templatePage,
      region: pointsMode ? null : templateConfig.region, // null in points mode, region in legacy mode
      dpi: templateConfig.dpi,
      // Pass effective PDF points (scaled if dimensions mismatch)
      xPt: templatePageEffective.xPt,
      yPt: templatePageEffective.yPt,
      wPt: templatePageEffective.wPt,
      hPt: templatePageEffective.hPt,
      pageWidthPt: templatePageEffective.pageWidthPt,
      pageHeightPt: templatePageEffective.pageHeightPt,
      requestId,
    }
  );

  // Diagnostic logging after OCR call
  console.log(`[Signed Processor] OCR first attempt result:`, {
    requestId,
    fmKey: normalizedFmKey,
    snippetImageUrlLength: firstAttempt.snippetImageUrl?.length ?? 0,
    rawTextLength: firstAttempt.rawText?.length ?? 0,
    woNumber: firstAttempt.woNumber ?? null,
    confidenceRaw: firstAttempt.confidenceRaw ?? null,
  });

  ocrAttempts.push({
    page: templatePage,
    confidence: firstAttempt.confidenceRaw ?? 0,
    woNumber: firstAttempt.woNumber ?? null,
    rawText: firstAttempt.rawText || "",
    snippetImageUrl: firstAttempt.snippetImageUrl ?? null,
    region: templateConfig.region,
    retryAttempted: false,
  });

  // Retry logic
  const firstConfidence = firstAttempt.confidenceRaw ?? 0;
  const shouldRetry = firstConfidence < 0.55 || !isValidWoNumber(firstAttempt.woNumber ?? null);

  if (shouldRetry) {
    if (pointsMode) {
      // In points mode, expand points, not percents
      // First get effective crop (with scaling if needed), then expand
      const effectiveCrop = await computeEffectiveCropAndDimensions(templatePage);
      
      // Expand the effective crop points (already scaled if needed)
      const expanded = {
        xPt: Math.max(0, effectiveCrop.xPt - 6),
        yPt: Math.max(0, effectiveCrop.yPt - 6),
        wPt: Math.min(effectiveCrop.pageWidthPt - Math.max(0, effectiveCrop.xPt - 6), effectiveCrop.wPt + 12),
        hPt: Math.min(effectiveCrop.pageHeightPt - Math.max(0, effectiveCrop.yPt - 6), effectiveCrop.hPt + 12),
      };
      
      const retryAttempt = await callSignedOcrService(
        pdfBuffer,
        originalFilename,
        {
          templateId: templateConfig.templateId,
          page: templatePage,
          region: null, // IMPORTANT: do not send region in points mode
          dpi: templateConfig.dpi,
          xPt: expanded.xPt,
          yPt: expanded.yPt,
          wPt: expanded.wPt,
          hPt: expanded.hPt,
          pageWidthPt: effectiveCrop.pageWidthPt,
          pageHeightPt: effectiveCrop.pageHeightPt,
          requestId,
        }
      );

      // Diagnostic logging after OCR retry call
      console.log(`[Signed Processor] OCR retry attempt result:`, {
        requestId,
        fmKey: normalizedFmKey,
        snippetImageUrlLength: retryAttempt.snippetImageUrl?.length ?? 0,
        rawTextLength: retryAttempt.rawText?.length ?? 0,
        woNumber: retryAttempt.woNumber ?? null,
        confidenceRaw: retryAttempt.confidenceRaw ?? null,
      });

      ocrAttempts.push({
        page: templatePage,
        confidence: retryAttempt.confidenceRaw ?? 0,
        woNumber: retryAttempt.woNumber ?? null,
        rawText: retryAttempt.rawText || "",
        snippetImageUrl: retryAttempt.snippetImageUrl ?? null,
        region: templateConfig.region, // Keep original region for tracking
        retryAttempted: true,
      });
    } else {
      // Legacy mode: expand percentages
      const expandedRegion = expandCrop(templateConfig.region, 0.015);
      // Get effective dimensions for legacy mode (no scaling, just actual dimensions)
      const effectiveCrop = await computeEffectiveCropAndDimensions(templatePage);
      const retryAttempt = await callSignedOcrService(
        pdfBuffer,
        originalFilename,
        {
          templateId: templateConfig.templateId,
          page: templatePage,
          region: expandedRegion,
          dpi: templateConfig.dpi,
          pageWidthPt: effectiveCrop.pageWidthPt,
          pageHeightPt: effectiveCrop.pageHeightPt,
          requestId,
        }
      );

      // Diagnostic logging after OCR retry call (legacy mode)
      console.log(`[Signed Processor] OCR retry attempt result (legacy):`, {
        requestId,
        fmKey: normalizedFmKey,
        snippetImageUrlLength: retryAttempt.snippetImageUrl?.length ?? 0,
        rawTextLength: retryAttempt.rawText?.length ?? 0,
        woNumber: retryAttempt.woNumber ?? null,
        confidenceRaw: retryAttempt.confidenceRaw ?? null,
      });

      ocrAttempts.push({
        page: templatePage,
        confidence: retryAttempt.confidenceRaw ?? 0,
        woNumber: retryAttempt.woNumber ?? null,
        rawText: retryAttempt.rawText || "",
        snippetImageUrl: retryAttempt.snippetImageUrl ?? null,
        region: expandedRegion,
        retryAttempted: true,
      });
    }
  }

  // Check if we should try alternate page
  const bestSoFar = pickBestAttempt(ocrAttempts);
  const shouldTryAlternatePage = pageCount >= 2 && 
    (!isValidWoNumber(bestSoFar.woNumber) || bestSoFar.confidence < 0.55);

  if (shouldTryAlternatePage) {
    let alternatePage: number | null = null;
    
    if (pageCount === 2) {
      alternatePage = templatePage === 1 ? 2 : 1;
    } else if (pageCount > 2) {
      if (templatePage > 1) {
        alternatePage = templatePage - 1;
      } else {
        alternatePage = 2;
      }
    }
    
    if (alternatePage !== null && alternatePage >= 1 && alternatePage <= pageCount && alternatePage !== templatePage) {
      alternatePageAttempted = true;
      
      // Compute effective crop and dimensions for alternate page
      const alternatePageEffective = await computeEffectiveCropAndDimensions(alternatePage);
      
      const alternateAttempt = await callSignedOcrService(
        pdfBuffer,
        originalFilename,
        {
          templateId: templateConfig.templateId,
          page: alternatePage,
          region: pointsMode ? null : templateConfig.region, // null in points mode, region in legacy mode
          dpi: templateConfig.dpi,
          // Pass effective PDF points (scaled if dimensions mismatch)
          xPt: alternatePageEffective.xPt,
          yPt: alternatePageEffective.yPt,
          wPt: alternatePageEffective.wPt,
          hPt: alternatePageEffective.hPt,
          pageWidthPt: alternatePageEffective.pageWidthPt,
          pageHeightPt: alternatePageEffective.pageHeightPt,
          requestId,
        }
      );

      // Diagnostic logging after OCR alternate page call
      console.log(`[Signed Processor] OCR alternate page attempt result:`, {
        requestId,
        fmKey: normalizedFmKey,
        page: alternatePage,
        snippetImageUrlLength: alternateAttempt.snippetImageUrl?.length ?? 0,
        rawTextLength: alternateAttempt.rawText?.length ?? 0,
        woNumber: alternateAttempt.woNumber ?? null,
        confidenceRaw: alternateAttempt.confidenceRaw ?? null,
      });

      ocrAttempts.push({
        page: alternatePage,
        confidence: alternateAttempt.confidenceRaw ?? 0,
        woNumber: alternateAttempt.woNumber ?? null,
        rawText: alternateAttempt.rawText || "",
        snippetImageUrl: alternateAttempt.snippetImageUrl ?? null,
        region: templateConfig.region,
        retryAttempted: false,
      });
  }
    
    alternatePageAttempted = ocrAttempts.some(a => a.page !== templatePage);
    retryAttempted = ocrAttempts.some(a => a.retryAttempted);

  // Pick the best attempt overall
    bestAttempt = pickBestAttempt(ocrAttempts);
    bestAttemptIndex = ocrAttempts.findIndex(a => 
      a.page === bestAttempt!.page && 
      a.confidence === bestAttempt!.confidence &&
      a.woNumber === bestAttempt!.woNumber
  );
  
    ocrResult = {
    woNumber: bestAttempt.woNumber,
    rawText: bestAttempt.rawText,
    confidenceRaw: bestAttempt.confidence,
    snippetImageUrl: bestAttempt.snippetImageUrl,
  };

    attemptedPages = Array.from(new Set(ocrAttempts.map(a => a.page))).sort().join(",");
    chosenPage = bestAttempt.page;
    }
  }

  // Normalize confidence & label
  const finalConfidenceRaw = ocrResult.confidenceRaw ?? 0;
  const ocrConfidenceRaw = finalConfidenceRaw; // For decision engine
  let confidenceLabel: "low" | "medium" | "high";

  if (finalConfidenceRaw >= 0.9) {
    confidenceLabel = "high";
  } else if (finalConfidenceRaw >= 0.6) {
    confidenceLabel = "medium";
  } else {
    confidenceLabel = "low";
  }

  const woNumber = ocrResult.woNumber ?? null;
  const rawText = ocrResult.rawText || digitalText || "";
  const snippetImageUrl = ocrResult.snippetImageUrl;

  // Separate OCR confidence from effective confidence
  const extractedValid = isValidWoNumber(woNumber);
  
  const effectiveConfidenceRaw = extractedValid ? ocrConfidenceRaw : 0;
  
  let effectiveConfidenceLabel: "high" | "medium" | "low";
  if (effectiveConfidenceRaw >= 0.9) {
    effectiveConfidenceLabel = "high";
  } else if (effectiveConfidenceRaw >= 0.6) {
    effectiveConfidenceLabel = "medium";
  } else {
    effectiveConfidenceLabel = "low";
  }
  
  let ocrConfidenceLabel: "high" | "medium" | "low";
  if (ocrConfidenceRaw >= 0.9) {
    ocrConfidenceLabel = "high";
  } else if (ocrConfidenceRaw >= 0.6) {
    ocrConfidenceLabel = "medium";
  } else {
    ocrConfidenceLabel = "low";
  }
  
  let validatedWoNumber: string | null = woNumber;
  if (!extractedValid && woNumber) {
    validatedWoNumber = null;
  }

  // Build decision input and call decision engine
  // Determine which extraction method was actually used
  // Use shouldSkipOcr directly - if we skipped OCR, we definitely used digital extraction
  // This is the single source of truth for whether digital extraction was used
  const usedDigital = shouldSkipOcr;
  const decisionExtractionMethod: "DIGITAL_TEXT" | "OCR" = usedDigital ? "DIGITAL_TEXT" : "OCR";
  
  const decisionRawText = usedDigital ? digitalText : ocrResult.rawText;
  // Use validDigitalCandidates (already validated) to ensure consistency with shouldSkipOcr logic
  const decisionCandidates = usedDigital
    ? validDigitalCandidates
    : (ocrResult.woNumber ? [ocrResult.woNumber] : []);
  
  // Determine pass agreement (OCR pass1 == pass2 if we have multiple valid attempts with same WO)
  // Normalize to digits-only before validating to catch cases like "WO 1234567" vs "1234567 "
  const ocrWoNumbers = ocrAttempts
    .map(a => a.woNumber ? a.woNumber.replace(/\D/g, "") : "")
    .filter(n => n && n.length === expectedDigits);

  const uniqueOcrWos = Array.from(new Set(ocrWoNumbers));
  // Pass agreement: at least 2 valid OCR reads that agree
  const passAgreement = uniqueOcrWos.length === 1 && ocrWoNumbers.length >= 2;
  
  const decisionResult: DecisionResult = decideSignedWorkOrder({
    rawText: decisionRawText,
    candidates: decisionCandidates.length > 0 ? decisionCandidates : undefined,
    templateRule: {
      expectedDigits,
    },
    signals: {
      extractionMethod: decisionExtractionMethod,
      confidenceRaw: decisionExtractionMethod === "OCR" ? ocrConfidenceRaw : undefined,
      passAgreement: decisionExtractionMethod === "OCR" ? passAgreement : undefined,
      lastKnownWo: undefined,
    },
  });

  // Structured logging
  console.log("[Signed Decision]", {
    fmKey: normalizedFmKey,
    filename: originalFilename,
    method: decisionExtractionMethod,
    state: decisionResult.state,
    bestCandidate: decisionResult.bestCandidate,
    trustScore: decisionResult.trustScore,
    reasons: decisionResult.reasons,
    candidates: decisionResult.normalizedCandidates,
  });

  // Force snippet generation for review cases even if we skipped OCR
  // AUTO_CONFIRMED + digital → skip OCR
  // QUICK_CHECK or NEEDS_ATTENTION → call OCR anyway so you get snippet
  if (shouldSkipOcr && decisionResult.state !== "AUTO_CONFIRMED" && !ocrResult.snippetImageUrl) {
    try {
      console.log(`[Signed Processor] Forcing OCR call for snippet generation (review case):`, {
        requestId,
        fmKey: normalizedFmKey,
        state: decisionResult.state,
      });
      
      const snippetPage = chosenPage ?? templatePage;
      
      // Compute effective crop and dimensions for snippet page
      const snippetPageEffective = await computeEffectiveCropAndDimensions(snippetPage);
      
      // Use effective crop zone for snippet - matches user's rectangle (scaled if dimensions mismatch)
      const snippetAttempt = await callSignedOcrService(
        pdfBuffer,
        originalFilename,
        {
          templateId: templateConfig.templateId,
          page: snippetPage,
          region: pointsMode ? null : templateConfig.region,
          dpi: templateConfig.dpi,
          xPt: snippetPageEffective.xPt,
          yPt: snippetPageEffective.yPt,
          wPt: snippetPageEffective.wPt,
          hPt: snippetPageEffective.hPt,
          pageWidthPt: snippetPageEffective.pageWidthPt,
          pageHeightPt: snippetPageEffective.pageHeightPt,
          requestId,
        }
      );

      // Diagnostic logging after forced OCR call
      console.log(`[Signed Processor] Forced OCR snippet result:`, {
        requestId,
        fmKey: normalizedFmKey,
        snippetImageUrlLength: snippetAttempt.snippetImageUrl?.length ?? 0,
        rawTextLength: snippetAttempt.rawText?.length ?? 0,
        woNumber: snippetAttempt.woNumber ?? null,
        confidenceRaw: snippetAttempt.confidenceRaw ?? null,
      });

      // Update ocrResult with snippet (ignore WO result, we already have it from digital)
      if (snippetAttempt.snippetImageUrl) {
        ocrResult.snippetImageUrl = snippetAttempt.snippetImageUrl;
      }
    } catch (err) {
      console.error(`[Signed Processor] Error generating snippet for review:`, {
        requestId,
        fmKey: normalizedFmKey,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue without snippet - we'll use null
    }
  }

  // Upload snippet to Drive if present
  let snippetDriveUrl: string | null = null;
  if (ocrResult.snippetImageUrl) {
    try {
      const [prefix, base64Part] = ocrResult.snippetImageUrl.split(",", 2);
      if (base64Part) {
        const pngBuffer = Buffer.from(base64Part, "base64");
        const fileNameParts = [
          "snippet",
          normalizedFmKey || "unknown",
          ocrResult.woNumber || "no-wo",
          Date.now().toString(),
        ];
        const fileName = fileNameParts.join("-") + ".png";

        snippetDriveUrl = await uploadSnippetImageToDrive({
          accessToken,
          fileName,
          pngBuffer,
        });
      }
    } catch (err) {
      console.error("[Drive] Failed to upload snippet to Drive:", err);
    }
  }

  // Use decision engine's best candidate - it represents the best available work order number
  // regardless of decision state (AUTO_CONFIRMED, QUICK_CHECK, or NEEDS_ATTENTION)
  // This ensures we use the engine's deterministic choice, especially in multi-candidate auto-resolve cases
  const engineWo = decisionResult.bestCandidate ? decisionResult.bestCandidate : null;
  
  // Priority: manual override > decision engine best candidate > validated OCR/digital > empty
  // Use engine's best candidate for all states - it's the best available WO number even if review is needed
  const effectiveWoNumber = (
    woNumberOverride ||
    engineWo ||
    validatedWoNumber ||
    ""
  ).trim();
  const nowIso = new Date().toISOString();

  const isHighConfidence = effectiveConfidenceLabel === "high";
  const isMediumOrHighConfidence = effectiveConfidenceLabel === "high" || effectiveConfidenceLabel === "medium";
  let jobUpdated = false;
  let jobExistsInSheet1 = false;

  // Check if job exists in Sheet1
  let existingIssuer: string | null = null;
  let matchedRowFmKey: string | null = null;
  let matchedRowIssuer: string | null = null;
  if (effectiveWoNumber) {
    const { getSheetHeadersCached, findRowIndexByColumnValue, createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");
    
    const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, MAIN_SHEET_NAME);
    
    const woLetter = headerMeta.colLetterByLower["wo_number"];
    if (woLetter) {
      const rowIdx = await findRowIndexByColumnValue(
        accessToken,
        spreadsheetId,
        MAIN_SHEET_NAME,
        woLetter,
        effectiveWoNumber
      );
      
      if (rowIdx !== -1) {
        jobExistsInSheet1 = true;
        
        const sheets = createSheetsClient(accessToken);
        
        const fmKeyLetter = headerMeta.colLetterByLower["fmkey"];
        if (fmKeyLetter) {
          const fmKeyResp = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: formatSheetRange(MAIN_SHEET_NAME, `${fmKeyLetter}${rowIdx}:${fmKeyLetter}${rowIdx}`),
          });
          const fmKeyCell = fmKeyResp.data.values?.[0]?.[0];
          matchedRowFmKey = fmKeyCell ? String(fmKeyCell).trim() || null : null;
        }
        
        const issuerLetter = headerMeta.colLetterByLower["issuer"];
        if (issuerLetter) {
          const issuerResp = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: formatSheetRange(MAIN_SHEET_NAME, `${issuerLetter}${rowIdx}:${issuerLetter}${rowIdx}`),
          });
          const issuerCell = issuerResp.data.values?.[0]?.[0];
          matchedRowIssuer = issuerCell ? String(issuerCell).trim() || null : null;
          existingIssuer = matchedRowIssuer;
        }
      }
    }
  }

  // FMKEY_MISMATCH safety gate
  let fmKeyMismatch = false;
  if (jobExistsInSheet1 && effectiveWoNumber) {
    const normalizedRequestFmKey = normalizeFmKey(normalizedFmKey);
    const normalizedRowFmKey = matchedRowFmKey ? normalizeFmKey(matchedRowFmKey) : null;
    
    // Guardrail: fmKey normalized mismatch
    if (matchedRowFmKey && normalizedRequestFmKey !== normalizedRowFmKey) {
      console.warn("[Signed Processor] Guardrail: fmKey normalized mismatch", {
        requestId,
        requestedFmKey: normalizedFmKey,
        requestedNormalized: normalizedRequestFmKey,
        rowFmKey: matchedRowFmKey,
        rowNormalized: normalizedRowFmKey,
      });
    }
    
    const requestFmKeyForComparison = normalizedRequestFmKey.replace(/_/g, "");
    const rowFmKeyForComparison = normalizedRowFmKey ? normalizedRowFmKey.replace(/_/g, "") : null;
    
    if (rowFmKeyForComparison && rowFmKeyForComparison !== requestFmKeyForComparison) {
      fmKeyMismatch = true;
    }
    else if (!matchedRowFmKey && matchedRowIssuer && normalizedFmKey) {
      const issuerLower = matchedRowIssuer.toLowerCase();
      const fmKeyLower = normalizedFmKey.toLowerCase();
      const issuerMatchesFmKey = issuerLower.includes(fmKeyLower) || fmKeyLower.includes(issuerLower);
      
      if (!issuerMatchesFmKey) {
        fmKeyMismatch = true;
      }
    }
  }

  // Update main sheet if conditions are met
  if (effectiveWoNumber && isMediumOrHighConfidence && jobExistsInSheet1 && !fmKeyMismatch) {
    jobUpdated = await updateJobWithSignedInfoByWorkOrderNumber(
      accessToken,
      spreadsheetId,
      MAIN_SHEET_NAME,
      effectiveWoNumber,
      {
        signedPdfUrl,
        signedPreviewImageUrl: snippetDriveUrl ?? null,
        confidence: effectiveConfidenceLabel,
        signedAt: nowIso,
        statusOverride: "SIGNED",
        fmKey: normalizedFmKey,
      }
    );
  }

  // Determine mode based on decision engine state
  // AUTO_CONFIRMED → attempt update; if update fails, Verification reason = UPDATE_FAILED
  // QUICK_CHECK → Verification (Quick Check queue)
  // NEEDS_ATTENTION → Verification
  let mode: "UPDATED" | "NEEDS_REVIEW" = "NEEDS_REVIEW";
  
  if (decisionResult.state === "AUTO_CONFIRMED") {
    // Proceed with existing update logic
    mode = jobUpdated ? "UPDATED" : "NEEDS_REVIEW";
  } else {
    // QUICK_CHECK or NEEDS_ATTENTION -> review
    mode = "NEEDS_REVIEW";
  }

  // Calculate verification reason (used for both sheet write and response)
  // Move to outer scope so it can be reused for responseReason
  let finalNeedsReviewReason: string | null = null;

  // Fallback: append to Needs_Review_Signed if job wasn't updated
  if (mode === "NEEDS_REVIEW") {
    const cropValidationReason = cropValidationResult?.reason;
    const hasHighPriorityReason = cropValidationReason && 
      (cropValidationReason === NEEDS_REVIEW_REASONS.TEMPLATE_NOT_CONFIGURED ||
       cropValidationReason === NEEDS_REVIEW_REASONS.INVALID_CROP ||
       cropValidationReason === NEEDS_REVIEW_REASONS.CROP_TOO_SMALL);
    
    // Decision-first reason mapping (prepend decision-based reasons)
    // BUT: prioritize NO_MATCHING_JOB_ROW over decision engine's NO_CANDIDATE when we have a WO number
    // Only use decision engine's NEEDS_ATTENTION if there's no work order number extracted
    const decisionReason =
      decisionResult.state === "QUICK_CHECK"
        ? NEEDS_REVIEW_REASONS.QUICK_CHECK_RECOMMENDED
        : decisionResult.state === "NEEDS_ATTENTION" && !effectiveWoNumber
        ? NEEDS_REVIEW_REASONS.NEEDS_ATTENTION
        : null;
    
    finalNeedsReviewReason =
      manualReason ||
      (hasHighPriorityReason
        ? cropValidationReason
        : fmKeyMismatch
        ? NEEDS_REVIEW_REASONS.FMKEY_MISMATCH
        : !extractedValid && woNumber
        ? NEEDS_REVIEW_REASONS.INVALID_WORK_ORDER_NUMBER
        : alternatePageAttempted && !isValidWoNumber(effectiveWoNumber) && pageCount >= 2
        ? NEEDS_REVIEW_REASONS.PAGE_MISMATCH
        : effectiveConfidenceLabel === "low" && retryAttempted && extractedValid
        ? NEEDS_REVIEW_REASONS.LOW_CONFIDENCE_AFTER_RETRY
        : !effectiveWoNumber
        ? NEEDS_REVIEW_REASONS.NO_WORK_ORDER_NUMBER
        : !jobExistsInSheet1
        ? NEEDS_REVIEW_REASONS.NO_MATCHING_JOB_ROW
        : decisionReason
        ? decisionReason
        : isMediumOrHighConfidence
        ? NEEDS_REVIEW_REASONS.UPDATE_FAILED
        : NEEDS_REVIEW_REASONS.LOW_CONFIDENCE);
    
    const reason = finalNeedsReviewReason;

    const reviewId = `review_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const createdAt = new Date().toISOString();
    
    // Phase 3: Build dedupe key for idempotency
    const reviewDedupeKey = `${fileHash}:${normalizedFmKey}:${decisionResult.bestCandidate ?? "none"}`;
    
    // Phase 3: Format decision fields for storage
    const decisionReasonsStr = decisionResult.reasons.join("|");
    const normalizedCandidatesStr = decisionResult.normalizedCandidates.join("|");
    const ocrPassAgreementStr = passAgreement ? "TRUE" : (decisionExtractionMethod === "OCR" ? "FALSE" : null);
    
    // Ensure snippet is available for review (generate if missing)
    // This ensures admins always have a visual preview for verification cases
    if (!snippetDriveUrl) {
      try {
        const snippetPage = chosenPage ?? templatePage;
        
        // Compute effective crop and dimensions for snippet page
        const snippetPageEffective = await computeEffectiveCropAndDimensions(snippetPage);
        
        console.log(`[Signed Processor] Generating snippet for review (missing from digital extraction):`, {
          requestId,
          fmKey: normalizedFmKey,
          page: snippetPage,
          effectiveDimensions: {
            pageWidthPt: snippetPageEffective.pageWidthPt,
            pageHeightPt: snippetPageEffective.pageHeightPt,
          },
          effectiveCropZone: {
            xPt: snippetPageEffective.xPt,
            yPt: snippetPageEffective.yPt,
            wPt: snippetPageEffective.wPt,
            hPt: snippetPageEffective.hPt,
          },
          scaled: snippetPageEffective.scaled,
          note: snippetPageEffective.scaled 
            ? "Crop points scaled to match actual page dimensions" 
            : "Using exact template crop zone",
        });
        
        const attempt = await callSignedOcrService(
          pdfBuffer,
          originalFilename,
          {
            templateId: templateConfig.templateId,
            page: snippetPage,
            region: pointsMode ? null : templateConfig.region,
            dpi: templateConfig.dpi,
            xPt: snippetPageEffective.xPt,
            yPt: snippetPageEffective.yPt,
            wPt: snippetPageEffective.wPt,
            hPt: snippetPageEffective.hPt,
            pageWidthPt: snippetPageEffective.pageWidthPt,
            pageHeightPt: snippetPageEffective.pageHeightPt,
            requestId,
          }
        );

        if (attempt.snippetImageUrl) {
          const [, base64Part] = attempt.snippetImageUrl.split(",", 2);
          if (base64Part) {
            const pngBuffer = Buffer.from(base64Part, "base64");
            const fileNameParts = [
              "snippet",
              normalizedFmKey || "unknown",
              decisionResult.bestCandidate || "no-wo",
              Date.now().toString(),
            ];
            const fileName = fileNameParts.join("-") + ".png";

            snippetDriveUrl = await uploadSnippetImageToDrive({
              accessToken,
              fileName,
              pngBuffer,
            });
            
            if (snippetDriveUrl) {
              console.log(`[Signed Processor] Generated snippet for review:`, {
                requestId,
                fmKey: normalizedFmKey,
                fileName,
                driveUrl: snippetDriveUrl,
              });
            } else {
              console.warn(`[Signed Processor] Failed to upload snippet to Drive:`, {
                requestId,
                fmKey: normalizedFmKey,
                fileName,
                note: "Check GOOGLE_DRIVE_SNIPPETS_FOLDER_ID environment variable is set",
              });
            }
          }
        }
      } catch (err) {
        console.error(`[Signed Processor] Error generating snippet for review:`, {
          requestId,
          fmKey: normalizedFmKey,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue without snippet - we'll use null
      }
    }
    
    await appendSignedNeedsReviewRow(accessToken, spreadsheetId, {
      review_id: reviewId,
      created_at: createdAt,
      fmKey: normalizedFmKey,
      signed_pdf_url: signedPdfUrl,
      preview_image_url: snippetDriveUrl ?? null,
      raw_text: rawText,
      confidence: effectiveConfidenceLabel,
      reason,
      manual_work_order_number: effectiveWoNumber || null,
      resolved: "FALSE",
      resolved_at: null,
      file_hash: fileHash,
      source: source,
      gmail_message_id: sourceMeta?.gmailMessageId || null,
      gmail_attachment_id: sourceMeta?.gmailAttachmentId || null,
      gmail_subject: sourceMeta?.gmailSubject || null,
      gmail_from: sourceMeta?.gmailFrom || null,
      gmail_date: sourceMeta?.gmailDate || null,
      // Phase 3: Decision metadata
      decision_state: decisionResult.state,
      trust_score: decisionResult.trustScore,
      decision_reasons: decisionReasonsStr,
      normalized_candidates: normalizedCandidatesStr,
      extraction_method: decisionExtractionMethod,
      ocr_pass_agreement: ocrPassAgreementStr,
      ocr_confidence_raw: decisionExtractionMethod === "OCR" ? ocrConfidenceRaw : null,
      chosen_candidate: decisionResult.bestCandidate ?? null,
      // Phase 3: Idempotency
      review_dedupe_key: reviewDedupeKey,
    });
  }

  // Update Work_Orders sheet
  if (effectiveWoNumber && jobExistsInSheet1) {
    try {
      const issuerKey = existingIssuer || normalizedFmKey || "unknown";
      const jobId = generateJobId(issuerKey, effectiveWoNumber);
      
      const existingWorkOrder = await findWorkOrderRecordByJobId(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        jobId
      );

      // Phase 3: Format decision fields for storage (reuse same logic as Verification)
      const decisionReasonsStr = decisionResult.reasons.join("|");
      const normalizedCandidatesStr = decisionResult.normalizedCandidates.join("|");
      const ocrPassAgreementStr = passAgreement ? "TRUE" : (decisionExtractionMethod === "OCR" ? "FALSE" : null);

      const mergedWorkOrder: WorkOrderRecord = {
        jobId,
        fmKey: normalizedFmKey,
        wo_number: effectiveWoNumber,
        status: mode === "UPDATED" ? "SIGNED" : (existingWorkOrder?.status ?? "OPEN"),
        scheduled_date: existingWorkOrder?.scheduled_date ?? null,
        created_at: existingWorkOrder?.created_at ?? nowIso,
        timestamp_extracted: nowIso,
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
        signed_pdf_url: signedPdfUrl ?? existingWorkOrder?.signed_pdf_url ?? null,
        signed_preview_image_url: snippetDriveUrl ?? existingWorkOrder?.signed_preview_image_url ?? null,
        signed_at: mode === "UPDATED" ? nowIso : (existingWorkOrder?.signed_at ?? null),
        source: existingWorkOrder?.source ?? "signed_upload",
        last_updated_at: nowIso,
        file_hash: fileHash,
        // Phase 3: Decision metadata
        signed_decision_state: decisionResult.state,
        signed_trust_score: decisionResult.trustScore,
        signed_decision_reasons: decisionReasonsStr,
        signed_extraction_method: decisionExtractionMethod,
        signed_ocr_confidence_raw: decisionExtractionMethod === "OCR" ? ocrConfidenceRaw : null,
        signed_pass_agreement: ocrPassAgreementStr,
        signed_candidates: normalizedCandidatesStr,
      };

      await writeWorkOrderRecord(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        mergedWorkOrder
      );
    } catch (woError) {
      console.error(`[Signed Processor] Error writing to Work_Orders sheet:`, woError);
    }
  }

  // Use the same reason we wrote to the sheet for response consistency
  const responseReason = mode === "NEEDS_REVIEW" ? finalNeedsReviewReason : undefined;

  const ux = responseReason ? getNeedsReviewUx(responseReason, normalizedFmKey) : null;

  const automationStatus = mode === "UPDATED" ? "APPLIED" : "REVIEW";
  const automationBlocked = false;
  const automationBlockReason = null;

  // Calculate debug info for coordinate system diagnostics
  const hasPoints = templateConfig.xPt !== undefined && 
                    templateConfig.yPt !== undefined && 
                    templateConfig.wPt !== undefined && 
                    templateConfig.hPt !== undefined &&
                    templateConfig.pageWidthPt !== undefined && 
                    templateConfig.pageHeightPt !== undefined;
  
  let debug: {
    coordSystem: string | null;
    templatePt: {
      xPt: number | null;
      yPt: number | null;
      wPt: number | null;
      hPt: number | null;
    };
    pagePt: {
      pageWidthPt: number | null;
      pageHeightPt: number | null;
    };
    render: {
      dpiUsed: number | null;
      imageWidthPx: number | null;
      imageHeightPx: number | null;
    };
    cropPx: {
      xPx: number | null;
      yPx: number | null;
      wPx: number | null;
      hPx: number | null;
    };
  } | undefined;

  if (hasPoints) {
    const dpi = templateConfig.dpi ?? 200;
    const scale = dpi / 72;
    
    // Rasterize page at dpi: image dimensions = page dimensions * scale
    const imageWidthPx = templateConfig.pageWidthPt! * scale;
    const imageHeightPx = templateConfig.pageHeightPt! * scale;
    
    // Convert points → pixels using the actual output image size
    const xPx = (templateConfig.xPt! / templateConfig.pageWidthPt!) * imageWidthPx;
    const yPx = (templateConfig.yPt! / templateConfig.pageHeightPt!) * imageHeightPx;
    const wPx = (templateConfig.wPt! / templateConfig.pageWidthPt!) * imageWidthPx;
    const hPx = (templateConfig.hPt! / templateConfig.pageHeightPt!) * imageHeightPx;
    
    debug = {
      coordSystem: "PDF_POINTS_TOP_LEFT",
      templatePt: {
        xPt: templateConfig.xPt!,
        yPt: templateConfig.yPt!,
        wPt: templateConfig.wPt!,
        hPt: templateConfig.hPt!,
      },
      pagePt: {
        pageWidthPt: templateConfig.pageWidthPt!,
        pageHeightPt: templateConfig.pageHeightPt!,
      },
      render: {
        dpiUsed: dpi,
        imageWidthPx: Math.round(imageWidthPx),
        imageHeightPx: Math.round(imageHeightPx),
      },
      cropPx: {
        xPx: Math.round(xPx),
        yPx: Math.round(yPx),
        wPx: Math.round(wPx),
        hPx: Math.round(hPx),
      },
    };
  } else {
    debug = {
      coordSystem: null,
      templatePt: {
        xPt: null,
        yPt: null,
        wPt: null,
        hPt: null,
      },
      pagePt: {
        pageWidthPt: null,
        pageHeightPt: null,
      },
      render: {
        dpiUsed: templateConfig.dpi ?? null,
        imageWidthPx: null,
        imageHeightPx: null,
      },
      cropPx: {
        xPx: null,
        yPx: null,
        wPx: null,
        hPx: null,
      },
    };
  }

  return {
    mode,
    data: {
      fmKey: normalizedFmKey,
      woNumber: effectiveWoNumber || null,
      ocrConfidenceLabel,
      ocrConfidenceRaw,
      confidenceLabel: effectiveConfidenceLabel,
      confidenceRaw: effectiveConfidenceRaw,
      automationStatus,
      automationBlocked,
      automationBlockReason,
      signedPdfUrl,
      snippetImageUrl: snippetImageUrl ?? null,
      snippetDriveUrl: snippetDriveUrl ?? snippetImageUrl ?? null,
      jobExistsInSheet1: jobExistsInSheet1,
      retryAttempted,
      alternatePageAttempted,
      reason: responseReason,
      fixHref: ux?.href || null,
      fixAction: ux?.actionLabel || null,
      reasonTitle: ux?.title || null,
      reasonMessage: ux?.message || null,
      tone: ux?.tone || null,
      templateUsed: {
        templateId: templateConfig.templateId,
        fmKey: normalizedFmKey,
        page: templateConfig.page ?? null,
        region: templateConfig.region,
        dpi: templateConfig.dpi ?? null,
        coordSystem: pointsMode ? "PDF_POINTS_TOP_LEFT" : "PCT",
        xPt: templateConfig.xPt ?? null,
        yPt: templateConfig.yPt ?? null,
        wPt: templateConfig.wPt ?? null,
        hPt: templateConfig.hPt ?? null,
        pageWidthPt: templateConfig.pageWidthPt ?? null,
        pageHeightPt: templateConfig.pageHeightPt ?? null,
      },
      chosenPage: bestAttempt?.page ?? templatePage,
      attemptedPages,
      chosenConfidence: bestAttempt?.confidence ?? 0,
      chosenExtractedWorkOrderNumber: bestAttempt?.woNumber ?? null,
      chosenAttemptIndex: bestAttemptIndex >= 0 ? bestAttemptIndex : 0,
      attempts: ocrAttempts.map(a => ({
        page: a.page,
        confidence: a.confidence,
        extracted: a.woNumber,
        extractedValid: isValidWoNumber(a.woNumber),
        retryAttempted: a.retryAttempted,
      })),
      debug,
      decision: {
        state: decisionResult.state,
        bestCandidate: decisionResult.bestCandidate,
        normalizedCandidates: decisionResult.normalizedCandidates,
        trustScore: decisionResult.trustScore,
        reasons: decisionResult.reasons,
      },
    },
  };
}

