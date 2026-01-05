/**
 * PDF page rendering utility using MuPDF WASM.
 * 
 * Renders a specific page of a PDF buffer to PNG format.
 * Designed to work on Vercel Node runtime without filesystem writes.
 * Uses MuPDF WASM for Vercel-safe PDF rendering.
 * 
 * Returns base64-encoded PNG data along with dimensions.
 */

// Memory safety limits
const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RENDERED_WIDTH = 1400; // pixels

// Lazy-init MuPDF WASM module and cache the initialized instance
let mupdfInstancePromise: Promise<any> | null = null;
// Track if MuPDF is unavailable (to avoid repeated import attempts)
let mupdfUnavailable = false;

async function getMupdfInstance() {
  // If we know MuPDF is unavailable, don't try to load it
  if (mupdfUnavailable) {
    throw new Error("MuPDF module is not available");
  }

  if (!mupdfInstancePromise) {
    mupdfInstancePromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // @ts-expect-error - mupdf module exists at runtime but has no type declarations
        const mupdfModule: any = await import("mupdf");

        // Most WASM bundles export an async init function as default.
        // If default is a function, call it (and await if it's async); otherwise, if it's already an object, use it.
        const init = mupdfModule.default || mupdfModule;

        if (typeof init === "function") {
          const result = init();
          // Handle both sync and async init functions
          return result instanceof Promise ? await result : result;
        } else {
          return init;
        }
      } catch (error) {
        // Mark MuPDF as unavailable to avoid future import attempts
        mupdfUnavailable = true;
        mupdfInstancePromise = null; // Clear the promise so we don't retry
        throw error;
      }
    })();
  }

  try {
    return await mupdfInstancePromise;
  } catch (error) {
    // If import failed, mark as unavailable
    mupdfUnavailable = true;
    mupdfInstancePromise = null;
    throw error;
  }
}

/**
 * Render a PDF page to PNG.
 * 
 * @param pdfBuffer PDF buffer
 * @param page Page number (1-indexed)
 * @returns Object with base64 PNG string and dimensions
 */
export async function renderPdfPageToPng(
  pdfBuffer: Buffer,
  page: number
): Promise<{ pngBase64: string; width: number; height: number; boundsPt: { x0: number; y0: number; x1: number; y1: number }; pageWidthPt: number; pageHeightPt: number }> {
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
    // Get the initialized MuPDF instance (cached, initialized once)
    let mupdf: any;
    try {
      mupdf = await getMupdfInstance();
    } catch (mupdfError) {
      // MuPDF module not available - provide clear error message
      mupdfUnavailable = true;
      const errorMessage = mupdfError instanceof Error ? mupdfError.message : String(mupdfError);
      throw new Error(
        `PDF rendering is not available: MuPDF module could not be loaded. ` +
        `This feature requires the MuPDF WASM module to be installed. ` +
        `Error: ${errorMessage}`
      );
    }
    
    // Log module structure for debugging
    console.log("[renderPdfPage] mupdf module keys:", Object.keys(mupdf).slice(0, 10));
    console.log("[renderPdfPage] mupdf.Document:", typeof mupdf.Document);
    
    // mupdf exports Document directly or as a property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Document = (mupdf as any).Document;
    
    if (!Document) {
      throw new Error("mupdf.Document is not available - module may not be fully initialized");
    }
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (Document as any).openDocument !== "function") {
      console.error("[renderPdfPage] Document structure:", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hasOpenDocument: !!(Document as any).openDocument,
        DocumentKeys: Object.keys(Document).slice(0, 10),
        DocumentType: typeof Document,
      });
      throw new Error("mupdf module not properly initialized. Document.openDocument is not available.");
    }

    // Load PDF document from buffer
    // Ensure buffer is a proper Uint8Array for mupdf
    console.log("[renderPdfPage] Opening document, buffer size:", pdfBuffer.length);
    const pdfUint8Array = new Uint8Array(pdfBuffer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (Document as any).openDocument(pdfUint8Array, "application/pdf");
    
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

    // ⚠️ CRITICAL: Always render using PDF page size, never embedded image size
    // Get page dimensions in PDF points (source of truth)
    // This is the canonical size - never use image width/height or DPI
    // 
    // MuPDF getBounds() returns CropBox if available, otherwise MediaBox.
    // We need to ensure we ALWAYS use the same box for consistency.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rect = (pdfPage as any).getBounds();
    
    // Ensure we're using the full box (not auto-zoomed to content)
    // getBounds() should return the full page box, but we verify it's consistent
    const boundsPt = { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 };
    const pageWidthPt = Math.ceil(rect.x1 - rect.x0);
    const pageHeightPt = Math.ceil(rect.y1 - rect.y0);
    
    // Log which box we're using for debugging
    console.log("[renderPdfPage] PDF box bounds (CropBox if available, else MediaBox):", {
      boundsPt,
      pageWidthPt,
      pageHeightPt,
      note: "getBounds() returns CropBox if available, otherwise MediaBox",
    });
    
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

    // Create a scale matrix for rendering
    // mupdf requires a Matrix object and ColorSpace
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Matrix = (mupdf as any).Matrix;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ColorSpace = (mupdf as any).ColorSpace;
    
    if (!Matrix || typeof Matrix.scale !== "function") {
      throw new Error("mupdf Matrix.scale is not available");
    }
    if (!ColorSpace) {
      throw new Error("mupdf ColorSpace is not available");
    }
    
    // ✅ IMPORTANT: normalize box origin to (0,0) before scaling
    // If boundsPt.x0/y0 != 0, failing to translate causes apparent zoom/shift/crop.
    console.log("[renderPdfPage] Building render matrix (translate + scale)");
    const hasTranslate = typeof (Matrix as any).translate === "function";
    const hasConcat = typeof (Matrix as any).concat === "function" || typeof (Matrix as any).multiply === "function";
    
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
        
        const translateMatrix = (Matrix as any).translate(-boundsPt.x0, -boundsPt.y0);
        const concatFn = (Matrix as any).concat ?? (Matrix as any).multiply;
        
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
    
    // mupdf.asPNG() returns a mupdf.Buffer, not a Node.js Buffer
    // Convert mupdf Buffer to Uint8Array, then to Node.js Buffer
    console.log("[renderPdfPage] Converting mupdf Buffer to Node.js Buffer");
    const uint8Array = pngMupdfBuffer.asUint8Array();
    const nodeBuffer = Buffer.from(uint8Array);

    // Convert to base64
    const pngBase64 = nodeBuffer.toString("base64");

    // Get actual pixmap dimensions (these are the actual rendered dimensions)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualW = (pixmap as any).width;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualH = (pixmap as any).height;
    
    const expectedW = Math.round(pageWidthPt * scale);
    const expectedH = Math.round(pageHeightPt * scale);
    
    // If we are off by more than a few pixels, the renderer is not honoring our chosen box.
    // In that case, we MUST return geometry that matches what was actually rendered.
    if (Math.abs(actualW - expectedW) > 8 || Math.abs(actualH - expectedH) > 8) {
      console.warn("[renderPdfPage] Rendered pixmap size does not match expected box; using EFFECTIVE bounds from getBounds()", {
        expected: { width: expectedW, height: expectedH },
        actual: { width: actualW, height: actualH },
        scale,
        boundsPt,
        pageWidthPt,
        pageHeightPt,
      });

      // Fall back to the effective box that toPixmap is actually using
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eff = (pdfPage as any).getBounds();
      const effBoundsPt = { x0: eff.x0, y0: eff.y0, x1: eff.x1, y1: eff.y1 };
      const effWPt = Math.round(effBoundsPt.x1 - effBoundsPt.x0);
      const effHPt = Math.round(effBoundsPt.y1 - effBoundsPt.y0);

      // Override what we return so downstream mapping matches the image users see
      // NOTE: Keep a log so you know this PDF cannot be normalized without a different render API
      console.warn("[renderPdfPage] Returning effective bounds that match actual rendered image:", {
        effectiveBoundsPt: effBoundsPt,
        effectivePageSize: { widthPt: effWPt, heightPt: effHPt },
        actualRenderSize: { width: actualW, height: actualH },
      });
      
      return {
        pngBase64,
        width: actualW,
        height: actualH,
        boundsPt: effBoundsPt,
        pageWidthPt: effWPt,
        pageHeightPt: effHPt,
      };
    }
    
    // Log PDF page size vs rendered image size for debugging
    console.log("[renderPdfPage] PDF page size (points) vs rendered image size (pixels):", {
      pageWidthPt,
      pageHeightPt,
      boundsPt,
      renderPx: { width: actualW, height: actualH },
      scale,
      expected: { width: expectedW, height: expectedH },
      match: Math.abs(actualW - expectedW) <= 8 && Math.abs(actualH - expectedH) <= 8,
    });

    // Return geometry matching the rendered image
    // - boundsPt: PDF box bounds (CropBox if available, else MediaBox)
    // - pageWidthPt/pageHeightPt: dimensions of the PDF box
    // - width/height: actual rendered image pixel dimensions
    return {
      pngBase64,
      width: actualW,
      height: actualH,
      boundsPt,
      pageWidthPt,
      pageHeightPt,
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

