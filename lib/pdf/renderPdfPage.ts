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

async function getMupdfInstance() {
  if (!mupdfInstancePromise) {
    mupdfInstancePromise = (async () => {
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
    })();
  }

  return mupdfInstancePromise;
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
): Promise<{ pngBase64: string; width: number; height: number }> {
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
    const mupdf = await getMupdfInstance();
    
    // Log module structure for debugging
    console.log("[renderPdfPage] mupdf module keys:", Object.keys(mupdf).slice(0, 10));
    console.log("[renderPdfPage] mupdf.Document:", typeof mupdf.Document);
    
    // mupdf exports Document directly or as a property
    const Document = (mupdf as any).Document;
    
    if (!Document) {
      throw new Error("mupdf.Document is not available - module may not be fully initialized");
    }
    
    if (typeof (Document as any).openDocument !== "function") {
      console.error("[renderPdfPage] Document structure:", {
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

    // Get page dimensions
    console.log("[renderPdfPage] Getting page bounds");
    const rect = pdfPage.getBounds();
    const pageWidth = Math.ceil(rect.x1 - rect.x0);
    const pageHeight = Math.ceil(rect.y1 - rect.y0);

    // Calculate scale to cap width at MAX_RENDERED_WIDTH
    let scale = 2.0; // Default scale for quality
    if (pageWidth * scale > MAX_RENDERED_WIDTH) {
      scale = MAX_RENDERED_WIDTH / pageWidth;
    }

    // Create a scale matrix for rendering
    // mupdf requires a Matrix object and ColorSpace
    const Matrix = (mupdf as any).Matrix;
    const ColorSpace = (mupdf as any).ColorSpace;
    
    if (!Matrix || typeof Matrix.scale !== "function") {
      throw new Error("mupdf Matrix.scale is not available");
    }
    if (!ColorSpace) {
      throw new Error("mupdf ColorSpace is not available");
    }
    
    console.log("[renderPdfPage] Creating scale matrix");
    let scaleMatrix;
    try {
      scaleMatrix = Matrix.scale(scale, scale);
      console.log("[renderPdfPage] Scale matrix created:", typeof scaleMatrix);
    } catch (err) {
      console.error("[renderPdfPage] Error creating scale matrix:", err);
      throw new Error(`Failed to create scale matrix: ${err instanceof Error ? err.message : String(err)}`);
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

    // Create a pixmap (image) from the page with scale matrix and RGB color space
    // toPixmap signature: toPixmap(matrix, colorspace, alpha = false, showExtras = true)
    console.log("[renderPdfPage] Creating pixmap with scale", scale, "matrix type:", typeof scaleMatrix, "colorspace type:", typeof rgbColorSpace);
    let pixmap;
    try {
      // Try with alpha=false and showExtras=true (defaults)
      pixmap = pdfPage.toPixmap(scaleMatrix, rgbColorSpace, false, true);
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

    // Calculate scaled dimensions
    const scaledWidth = Math.ceil(pageWidth * scale);
    const scaledHeight = Math.ceil(pageHeight * scale);

    return {
      pngBase64,
      width: scaledWidth,
      height: scaledHeight,
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

