/**
 * PDF page rendering utility using MuPDF WASM.
 * 
 * Renders a specific page of a PDF buffer to PNG format.
 * Designed to work on Vercel Node runtime without filesystem writes.
 * Uses MuPDF WASM for Vercel-safe PDF rendering.
 * 
 * Returns base64-encoded PNG data along with dimensions.
 */

import {
  getMuPdfDocument,
  getMuPdfMatrix,
  getMuPdfColorSpace,
  getPixmapDims,
  getPageBounds,
} from "./engines/mupdfEngine";

// Memory safety limits
const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RENDERED_WIDTH = 1400; // pixels

/**
 * Render a PDF page to PNG.
 * 
 * @param pdfBuffer PDF buffer
 * @param page Page number (1-indexed)
 * @returns Object with base64 PNG string, dimensions, and total page count
 */
export async function renderPdfPageToPng(
  pdfBuffer: Buffer,
  page: number
): Promise<{ pngDataUrl: string; widthPx: number; heightPx: number; boundsPt: { x0: number; y0: number; x1: number; y1: number }; pageWidthPt: number; pageHeightPt: number; page: number; totalPages: number }> {
  // Validate PDF buffer size
  if (pdfBuffer.length > MAX_PDF_SIZE) {
    throw new Error(`PDF file too large. Maximum size is ${MAX_PDF_SIZE / 1024 / 1024}MB.`);
  }

  if (pdfBuffer.length < 10) {
    throw new Error("PDF buffer is too small or invalid.");
  }

  // Validate PDF header
  const header = pdfBuffer.subarray(0, 5).toString("utf8");
  if (header !== "%PDF-") {
    throw new Error("Invalid PDF file format.");
  }

  // Validate page number
  if (page < 1) {
    throw new Error("Page number must be 1 or greater.");
  }

  try {
    // Get MuPDF Document class from engine
    const Document = await getMuPdfDocument();

    // Load PDF document from buffer
    // Ensure buffer is a proper Uint8Array for mupdf
    console.log("[renderPdfPage] Opening document, buffer size:", pdfBuffer.length);
    const pdfUint8Array = new Uint8Array(pdfBuffer);
    const doc = Document.openDocument(pdfUint8Array, "application/pdf");
    
    if (!doc) {
      throw new Error("Failed to open PDF document");
    }

    // Validate page number against document
    console.log("[renderPdfPage] Getting page count");
    const pageCount = doc.countPages();
    if (page > pageCount) {
      throw new Error(`Page ${page} is out of range. Document has ${pageCount} page(s).`);
    }

    // Get the requested page (convert to 0-indexed)
    console.log("[renderPdfPage] Loading page", page - 1);
    const pdfPage = doc.loadPage(page - 1);
    
    if (!pdfPage) {
      throw new Error("Failed to load PDF page");
    }

    // Extract page bounds using engine helper
    const boundsPt = getPageBounds(pdfPage);
    const pageWidthPt = boundsPt.x1 - boundsPt.x0;
    const pageHeightPt = boundsPt.y1 - boundsPt.y0;

    console.log("[renderPdfPage] page box resolved:", { boundsPt, pageWidthPt, pageHeightPt });
    
    // Guard: ensure page dimensions are valid
    if (pageWidthPt <= 0 || pageHeightPt <= 0) {
      throw new Error(`Invalid PDF page dimensions: width=${pageWidthPt}, height=${pageHeightPt}. Bounds: ${JSON.stringify(boundsPt)}`);
    }
    
    // Use points for scale calculation (never use image dimensions)
    const pageWidth = pageWidthPt;
    const pageHeight = pageHeightPt;

    // Calculate scale to cap width at MAX_RENDERED_WIDTH
    // Scale is based on PDF page size, not image size
    let scale = 2.0; // Default scale for quality
    if (pageWidth * scale > MAX_RENDERED_WIDTH) {
      scale = MAX_RENDERED_WIDTH / pageWidth;
    }
    
    // Calculate canvas dimensions based on scaled PDF viewport
    const canvasWidth = Math.ceil(pageWidth * scale);
    const canvasHeight = Math.ceil(pageHeight * scale);
    
    // Log PDF page size vs canvas size for debugging
    console.log("[renderPdfPage] PDF page size (points) vs canvas size (pixels):", {
      pageWidthPt,
      pageHeightPt,
      canvasWidth,
      canvasHeight,
      scale,
      boundsOrigin: { x0: boundsPt.x0, y0: boundsPt.y0 },
    });

    // Get MuPDF Matrix and ColorSpace from engine
    const Matrix = await getMuPdfMatrix();
    const ColorSpace = await getMuPdfColorSpace();
    
    // ✅ IMPORTANT: normalize box origin to (0,0) before scaling
    // If boundsPt.x0/y0 != 0, failing to translate causes apparent zoom/shift/crop.
    console.log("[renderPdfPage] Building render matrix (translate + scale)");
    const hasTranslate = typeof Matrix.translate === "function";
    const hasConcat = typeof Matrix.concat === "function" || typeof Matrix.multiply === "function";
    
    let renderMatrix;
    try {
      // Start with scale matrix
      renderMatrix = Matrix.scale(scale, scale);
      
      // If box has non-zero origin, translate first, then scale
      if ((boundsPt.x0 !== 0 || boundsPt.y0 !== 0) && hasTranslate && hasConcat) {
        console.log("[renderPdfPage] Translating to normalize box origin:", {
          translateBy: { x: -boundsPt.x0, y: -boundsPt.y0 },
          originalBounds: boundsPt,
        });
        
        const translateMatrix = Matrix.translate(-boundsPt.x0, -boundsPt.y0);
        const concatFn = Matrix.concat ?? Matrix.multiply;
        
        // renderMatrix = scale ∘ translate (translate first, then scale)
        renderMatrix = concatFn(renderMatrix, translateMatrix);
      } else if (boundsPt.x0 !== 0 || boundsPt.y0 !== 0) {
        // If translate/concat isn't supported, we can't normalize origin safely.
        console.warn("[renderPdfPage] Matrix.translate/concat not available; zoom may persist for non-zero bounds origin", {
          boundsPt,
          hasTranslate,
          hasConcat,
        });
      }
      
      console.log("[renderPdfPage] Render matrix created:", typeof renderMatrix);
    } catch (err) {
      console.error("[renderPdfPage] Error creating render matrix:", err);
      throw new Error(`Failed to create render matrix: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // Use RGB color space for PNG output
    console.log("[renderPdfPage] Getting RGB color space");
    let rgbColorSpace;
    try {
      rgbColorSpace = ColorSpace.DeviceRGB;
      console.log("[renderPdfPage] RGB color space:", typeof rgbColorSpace, rgbColorSpace ? "exists" : "null");
    } catch (err) {
      console.error("[renderPdfPage] Error getting color space:", err);
      throw new Error(`Failed to get RGB color space: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Create a pixmap (image) from the page with render matrix and RGB color space
    // toPixmap signature: toPixmap(matrix, colorspace, alpha = false, showExtras = true)
    // 
    // CRITICAL: We render the FULL page box (CropBox/MediaBox) without auto-zoom to content.
    // The renderMatrix translates (if needed) then scales the entire boundsPt box, ensuring consistent rendering.
    console.log("[renderPdfPage] Creating pixmap with render matrix, scale:", scale);
    let pixmap;
    try {
      // Render with showExtras=true to include all page content (not just visible content)
      // This ensures scanned PDFs render the full page, not auto-zoomed to content
      pixmap = pdfPage.toPixmap(renderMatrix, rgbColorSpace, false, true);
      console.log("[renderPdfPage] Pixmap created:", typeof pixmap);
    } catch (err) {
      console.error("[renderPdfPage] Error creating pixmap:", err);
      console.error("[renderPdfPage] Error details:", {
        errorType: err?.constructor?.name,
        errorMessage: err instanceof Error ? err.message : String(err),
        errorStack: err instanceof Error ? err.stack : undefined,
      });
      throw new Error(`Failed to create pixmap: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    if (!pixmap) {
      throw new Error("Failed to create pixmap from PDF page");
    }

    // Convert pixmap to PNG buffer
    console.log("[renderPdfPage] Converting pixmap to PNG");
    const pngMupdfBuffer = pixmap.asPNG();
    
    if (!pngMupdfBuffer) {
      throw new Error("Failed to convert pixmap to PNG");
    }
    
    // Get actual pixmap dimensions (these are the actual rendered dimensions)
    const { widthPx, heightPx } = getPixmapDims(pixmap);

    console.log("[renderPdfPage] Pixmap dims resolved:", {
      widthPx,
      heightPx,
      pixKeys: pixmap ? Object.keys(pixmap) : null,
      widthType: typeof pixmap?.width,
      heightType: typeof pixmap?.height,
      wType: typeof pixmap?.w,
      hType: typeof pixmap?.h,
      hasGetWidth: typeof pixmap?.getWidth === "function",
      hasGetHeight: typeof pixmap?.getHeight === "function",
    });
    
    // Guard: ensure pixmap dimensions are valid
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
      throw new Error(`Invalid pixmap dimensions: width=${widthPx}, height=${heightPx}`);
    }
    
    // Geometry check: verify PDF points align with rendered pixels
    console.log("[renderPdfPage] Geometry check:", {
      pageWidthPt,
      pageHeightPt,
      widthPx,
      heightPx,
      scaleApproxW: widthPx / pageWidthPt,
      scaleApproxH: heightPx / pageHeightPt,
    });
    
    // mupdf.asPNG() returns a mupdf.Buffer, not a Node.js Buffer
    // Convert mupdf Buffer to Node.js Buffer, then to base64
    console.log("[renderPdfPage] Converting mupdf Buffer to Node.js Buffer");
    const pngUint8 = pngMupdfBuffer?.asUint8Array?.() ?? pngMupdfBuffer?.asUint8Array ?? pngMupdfBuffer;
    const pngBuffer = Buffer.isBuffer(pngUint8) ? pngUint8 : Buffer.from(pngUint8);
    const pngBase64 = pngBuffer.toString("base64");
    const pngDataUrl = `data:image/png;base64,${pngBase64}`;
    
    // Return geometry matching the rendered image
    // - boundsPt: PDF box bounds (CropBox if available, else MediaBox) - all real numbers
    // - pageWidthPt/pageHeightPt: dimensions of the PDF box - computed from bounds
    // - widthPx/heightPx: actual rendered image pixel dimensions - from pixmap
    // - pngDataUrl: full data URL for the rendered image
    // - page: the page number that was rendered (1-indexed)
    // - totalPages: total number of pages in the PDF document
    return {
      pngDataUrl,
      widthPx,
      heightPx,
      boundsPt,
      pageWidthPt,
      pageHeightPt,
      page,
      totalPages: pageCount,
    };
  } catch (error) {
    console.error("[renderPdfPage] Error rendering PDF page:", error);
    if (error instanceof Error) {
      // Re-throw with clear error message for API route handling
      throw new Error(`Failed to render PDF page ${page}: ${error.message}`);
    }
    throw new Error(`Failed to render PDF page ${page}: Unknown error`);
  }
}

