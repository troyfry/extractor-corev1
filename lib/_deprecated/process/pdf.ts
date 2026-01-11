/**
 * Process Access Layer - PDF Operations
 * 
 * Wrappers for PDF rendering and raster detection.
 * All PDF operations go through this module to ensure consistent intent policy handling.
 */

import { renderPdfPageToPng } from "@/lib/pdf/renderPdfPage";
import { detectRasterOnlyPdf as detectRasterOnlyPdfImpl } from "@/lib/templates";
import { normalizePdfBuffer } from "@/lib/pdf/normalizePdf";
import { resolvePdfIntentPolicy, type PdfIntent } from "@/lib/pdf/intent";
import { pdfInputToBuffer, type PdfInput } from "./types";

/**
 * Render a PDF page to PNG with intent-based policy.
 * 
 * @param params.pdf - PDF buffer or File
 * @param params.page - Page number (1-based)
 * @param params.intent - PDF intent (TEMPLATE_CAPTURE, SIGNED_PROCESSING, GENERAL_VIEW)
 * @param params.allowRaster - Allow raster-only PDFs (default: false for TEMPLATE_CAPTURE, true otherwise)
 * @param params.skipNormalization - Skip PDF normalization (legacy flag, honored if intent missing)
 * @returns Rendered page data with dimensions and geometry
 */
export async function renderPdfPage(params: {
  pdf: PdfInput;
  page: number;
  intent?: PdfIntent | null;
  allowRaster?: boolean;
  skipNormalization?: boolean;
}): Promise<{
  pngDataUrl: string;
  widthPx: number;
  heightPx: number;
  pageWidthPt: number;
  pageHeightPt: number;
  boundsPt: { x0: number; y0: number; x1: number; y1: number };
  page: number;
  totalPages: number;
}> {
  const { pdf, page, intent, allowRaster, skipNormalization } = params;

  // Convert input to buffer
  let pdfBuffer = await pdfInputToBuffer(pdf);
  const originalSize = pdfBuffer.length;

  // Resolve intent policy
  const policy = resolvePdfIntentPolicy({
    intent: intent ?? null,
    allowRaster: allowRaster ?? undefined,
    skipNormalization: skipNormalization ?? undefined,
    legacyDefaultSkipNormalization: false, // render-page default was to normalize
  });

  // Raster detection and blocking - check BEFORE normalization
  if (policy.shouldBlockRaster) {
    try {
      const isRasterOnly = await detectRasterOnlyPdfImpl(pdfBuffer);
      if (isRasterOnly) {
        console.log("[process/pdf] renderPdfPage: raster-only PDF blocked", {
          intent: policy.intent,
          page,
        });
        throw new Error(
          "Template capture requires a digital PDF with a text layer (not a scan). Upload the original work order PDF."
        );
      }
    } catch (rasterError) {
      // If raster detection fails, log but don't block (fail open for robustness)
      if (rasterError instanceof Error && rasterError.message.includes("Template capture requires")) {
        throw rasterError; // Re-throw blocking errors
      }
      console.warn("[process/pdf] renderPdfPage: raster detection failed, allowing PDF", {
        intent: policy.intent,
        page,
        error: rasterError instanceof Error ? rasterError.message : String(rasterError),
      });
    }
  }

  // Normalize PDF if requested
  if (policy.normalize) {
    try {
      const normalizedBuffer = await normalizePdfBuffer(pdfBuffer);
      if (normalizedBuffer !== pdfBuffer) {
        console.log("[process/pdf] renderPdfPage: PDF normalized", {
          intent: policy.intent,
          page,
          originalSize,
          normalizedSize: normalizedBuffer.length,
        });
        pdfBuffer = Buffer.from(normalizedBuffer);
      }
    } catch (normalizeError) {
      // If normalization fails, continue with original buffer (fail gracefully)
      console.warn("[process/pdf] renderPdfPage: normalization failed, using original PDF", {
        intent: policy.intent,
        page,
        error: normalizeError instanceof Error ? normalizeError.message : String(normalizeError),
      });
    }
  }

  // Log operation
  console.log("[process/pdf] renderPdfPage", {
    intent: policy.intent ?? "legacy",
    page,
    normalize: policy.normalize,
    allowRaster: policy.allowRaster,
  });

  // Render page
  const result = await renderPdfPageToPng(pdfBuffer, page);

  return result;
}

/**
 * Detect if a PDF is raster/scan-only (no text layer).
 * 
 * @param params.pdf - PDF buffer or File
 * @returns Detection result
 */
export async function detectRasterOnlyPdf(params: {
  pdf: PdfInput;
}): Promise<{ isRasterOnly: boolean }> {
  const { pdf } = params;

  // Convert input to buffer
  const pdfBuffer = await pdfInputToBuffer(pdf);

  // Log operation
  console.log("[process/pdf] detectRasterOnlyPdf");

  // Detect raster
  const isRasterOnly = await detectRasterOnlyPdfImpl(pdfBuffer);

  return { isRasterOnly };
}

