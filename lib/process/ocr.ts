/**
 * Process Access Layer - OCR Operations
 * 
 * Wrappers for OCR work order number extraction.
 * All OCR operations go through this module.
 */

import { callSignedOcrService } from "@/lib/workOrders/signedOcr";
import { pdfInputToBuffer, type PdfInput, type RegionPoints } from "./types";

/**
 * Extract work order number from PDF using OCR.
 * 
 * @param params.pdf - PDF buffer or File
 * @param params.fmKey - Facility management key (template identifier)
 * @param params.page - Page number (1-based)
 * @param params.dpi - DPI for rendering (default: 200)
 * @param params.regionPoints - Crop region in PDF points
 * @returns OCR result with work order number, confidence, raw text, and snippet URL
 */
export async function ocrWorkOrderNumberFromUpload(params: {
  pdf: PdfInput;
  fmKey: string;
  page: number;
  dpi?: number;
  regionPoints: RegionPoints;
}): Promise<{
  workOrderNumber: string | null;
  confidence?: number;
  rawText?: string;
  snippetImageUrl?: string | null;
}> {
  const { pdf, fmKey, page, dpi = 200, regionPoints } = params;

  // Convert input to buffer
  const pdfBuffer = await pdfInputToBuffer(pdf);
  const filename = pdf instanceof File ? pdf.name : "uploaded.pdf";

  // Validate region points
  const { xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt } = regionPoints;
  if (
    !Number.isFinite(xPt) || !Number.isFinite(yPt) || !Number.isFinite(wPt) || !Number.isFinite(hPt) ||
    !Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt) ||
    wPt <= 0 || hPt <= 0 || pageWidthPt <= 0 || pageHeightPt <= 0
  ) {
    throw new Error("Invalid region points: all values must be finite positive numbers");
  }

  if (page < 1) {
    throw new Error("page must be >= 1 (1-based)");
  }

  // Log operation
  console.log("[process/ocr] ocrWorkOrderNumberFromUpload", {
    fmKey,
    page,
    dpi,
  });

  // Call OCR service
  const result = await callSignedOcrService(pdfBuffer, filename, {
    templateId: fmKey,
    page,
    region: null, // Points mode - no region
    dpi,
    xPt,
    yPt,
    wPt,
    hPt,
    pageWidthPt,
    pageHeightPt,
  });

  // Return normalized result
  return {
    workOrderNumber: result.woNumber,
    confidence: result.confidenceRaw,
    rawText: result.rawText,
    snippetImageUrl: result.snippetImageUrl,
  };
}

