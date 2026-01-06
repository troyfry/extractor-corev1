/**
 * PDF normalization utility using MuPDF WASM.
 * 
 * Normalizes PDF files by fixing coordinate systems and bounds before upload.
 * This ensures all PDFs have consistent coordinate systems (0-based origin).
 * 
 * Uses MuPDF to:
 * 1. Open the PDF
 * 2. For each page, normalize bounds to (0,0) origin
 * 3. Create a new normalized PDF
 * 4. Return the normalized PDF buffer
 */

import { getMuPdfDocument, getMuPdfPDFDocument, getMuPdfMatrix, getMuPdfColorSpace, getPageBounds } from "./engines/mupdfEngine";

// Memory safety limits
const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB


/**
 * Normalize a PDF buffer by fixing coordinate systems and bounds.
 * 
 * This function:
 * 1. Opens the PDF with MuPDF
 * 2. For each page, normalizes bounds to (0,0) origin
 * 3. Creates a new normalized PDF document
 * 4. Returns the normalized PDF buffer
 * 
 * @param pdfBuffer Original PDF buffer
 * @returns Normalized PDF buffer, or original buffer if normalization fails
 */
export async function normalizePdfBuffer(
  pdfBuffer: Buffer
): Promise<Buffer> {
  // Validate PDF buffer size
  if (pdfBuffer.length > MAX_PDF_SIZE) {
    console.warn(`[Normalize PDF] PDF file too large (${pdfBuffer.length} bytes), skipping normalization`);
    return pdfBuffer;
  }

  if (pdfBuffer.length < 10) {
    console.warn("[Normalize PDF] PDF buffer is too small or invalid, skipping normalization");
    return pdfBuffer;
  }

  // Validate PDF header
  const header = pdfBuffer.subarray(0, 5).toString("utf8");
  if (header !== "%PDF-") {
    console.warn("[Normalize PDF] Invalid PDF file format, skipping normalization");
    return pdfBuffer;
  }

  try {
    // Get the MuPDF Document class from engine
    const Document = await getMuPdfDocument();

    // Load PDF document from buffer
    const pdfUint8Array = new Uint8Array(pdfBuffer);
    const sourceDoc = Document.openDocument(pdfUint8Array, "application/pdf");
    
    if (!sourceDoc) {
      console.warn("⚠️ [NORMALIZATION] Failed to open PDF document, skipping file normalization:", {
        note: "Python OCR service will normalize during OCR processing when pageWidthPt/pageHeightPt are provided",
        timestamp: new Date().toISOString(),
      });
      return pdfBuffer;
    }

    const pageCount = sourceDoc.countPages();
    if (pageCount === 0) {
      console.warn("⚠️ [NORMALIZATION] PDF has no pages, skipping file normalization:", {
        timestamp: new Date().toISOString(),
      });
      return pdfBuffer;
    }

    // Create a new PDF document for normalized output
    const PDFDocument = await getMuPdfPDFDocument();
    const normalizedDoc = PDFDocument.create();
    if (!normalizedDoc) {
      console.warn("⚠️ [NORMALIZATION] Failed to create normalized PDF document, skipping file normalization:", {
        note: "Python OCR service will normalize during OCR processing when pageWidthPt/pageHeightPt are provided",
        timestamp: new Date().toISOString(),
      });
      return pdfBuffer;
    }

    // Process each page
    let needsNormalization = false;
    for (let pageNum = 0; pageNum < pageCount; pageNum++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sourcePage = sourceDoc.loadPage(pageNum);
      if (!sourcePage) {
        console.warn(`[Normalize PDF] Failed to load page ${pageNum + 1}, skipping`);
        continue;
      }

      // Get page bounds using engine helper
      const boundsPt = getPageBounds(sourcePage);
      const pageWidthPt = Math.ceil(boundsPt.x1 - boundsPt.x0);
      const pageHeightPt = Math.ceil(boundsPt.y1 - boundsPt.y0);

      // Check if normalization is needed (non-zero origin)
      if (boundsPt.x0 !== 0 || boundsPt.y0 !== 0) {
        needsNormalization = true;
        console.log(`🔧 [NORMALIZATION] Page ${pageNum + 1} has non-zero origin, will normalize:`, {
          originalBounds: boundsPt,
          pageWidthPt,
          pageHeightPt,
          timestamp: new Date().toISOString(),
        });
      }

      // Create a new page in the normalized document with normalized bounds
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const normalizedPage = (normalizedDoc as any).newPage(pageWidthPt, pageHeightPt);
      if (!normalizedPage) {
        console.warn(`[Normalize PDF] Failed to create normalized page ${pageNum + 1}, skipping`);
        continue;
      }

      // Create transformation matrix to translate content to (0,0)
      const Matrix = await getMuPdfMatrix();
      const ColorSpace = await getMuPdfColorSpace();
      if (Matrix && typeof Matrix.translate === "function") {
        // Translate to normalize origin, then copy content
        const translateMatrix = Matrix.translate(-boundsPt.x0, -boundsPt.y0);
        
        // Copy page content with transformation
        if (typeof normalizedPage.run === "function") {
          normalizedPage.run(sourcePage, translateMatrix, ColorSpace.DeviceRGB);
        } else if (typeof (normalizedPage as any).showPage === "function") {
          // Alternative API: showPage with transformation
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (normalizedPage as any).showPage(sourcePage, translateMatrix);
        } else {
          // Fallback: try to insert page directly (may not normalize, but preserves content)
          console.warn(`[Normalize PDF] Page ${pageNum + 1} transformation API not available, copying without normalization`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof (normalizedDoc as any).insertPage === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (normalizedDoc as any).insertPage(pageNum, sourcePage);
          }
        }
      } else {
        // Matrix.translate not available - copy page without transformation
        console.warn(`[Normalize PDF] Matrix.translate not available for page ${pageNum + 1}, copying without normalization`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (normalizedDoc as any).insertPage === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (normalizedDoc as any).insertPage(pageNum, sourcePage);
        }
      }
    }

    // If no normalization was needed, return original buffer
    if (!needsNormalization) {
      console.log("ℹ️ [NORMALIZATION] All pages already normalized (0-based origin), returning original PDF:", {
        pageCount,
        timestamp: new Date().toISOString(),
      });
      return pdfBuffer;
    }

    // Save normalized document to buffer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalizedBuffer = (normalizedDoc as any).save();
    if (!normalizedBuffer) {
      console.warn("[Normalize PDF] Failed to save normalized PDF, returning original");
      return pdfBuffer;
    }

    // Convert MuPDF buffer to Node.js Buffer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (normalizedBuffer as any).asUint8Array === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uint8Array = (normalizedBuffer as any).asUint8Array();
      const normalizedPdfBuffer = Buffer.from(uint8Array);
      
      console.log("✅ [NORMALIZATION] PDF NORMALIZED SUCCESSFULLY via MuPDF:", {
        originalSize: pdfBuffer.length,
        normalizedSize: normalizedPdfBuffer.length,
        sizeChange: normalizedPdfBuffer.length - pdfBuffer.length,
        pageCount,
        timestamp: new Date().toISOString(),
      });
      
      return normalizedPdfBuffer;
    } else {
      console.warn("[Normalize PDF] Normalized buffer.asUint8Array() not available, returning original");
      return pdfBuffer;
    }
  } catch (error) {
    // If normalization fails, return original buffer (fail gracefully)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isMupdfError = errorMessage.includes("Cannot find module 'mupdf'") || 
                         errorMessage.includes("mupdf") ||
                         errorMessage.includes("MuPDF");
    
    if (isMupdfError) {
      // MuPDF module not available - this is expected in some environments
      // The inner try-catch should have caught this, but if it didn't, handle it here
      console.warn("⚠️ [NORMALIZATION] MuPDF not available, cannot normalize PDF file:", {
        error: errorMessage,
        note: "Python OCR service will normalize during OCR processing when pageWidthPt/pageHeightPt are provided. Original PDF will be uploaded.",
        timestamp: new Date().toISOString(),
      });
    } else {
      console.warn("⚠️ [NORMALIZATION] Error during normalization, returning original PDF:", {
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
    return pdfBuffer;
  }
}

