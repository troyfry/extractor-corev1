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
    // Dynamic import to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mupdf = require("mupdf");

    // Load PDF document from buffer
    const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");

    // Validate page number against document
    const pageCount = doc.countPages();
    if (page > pageCount) {
      throw new Error(`Page ${page} is out of range. Document has ${pageCount} page(s).`);
    }

    // Get the requested page (convert to 0-indexed)
    const pdfPage = doc.loadPage(page - 1);

    // Get page dimensions
    const rect = pdfPage.bound();
    const pageWidth = Math.ceil(rect.x1 - rect.x0);
    const pageHeight = Math.ceil(rect.y1 - rect.y0);

    // Calculate scale to cap width at MAX_RENDERED_WIDTH
    let scale = 2.0; // Default scale for quality
    if (pageWidth * scale > MAX_RENDERED_WIDTH) {
      scale = MAX_RENDERED_WIDTH / pageWidth;
    }

    // Create a pixmap (image) from the page with scale
    // toPixmap takes scale directly (not a transform matrix)
    const pixmap = pdfPage.toPixmap(scale);

    // Convert pixmap to PNG buffer
    const pngBuffer = pixmap.asPNG();

    // Convert to base64
    const pngBase64 = pngBuffer.toString("base64");

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

