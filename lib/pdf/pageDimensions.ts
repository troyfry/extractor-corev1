/**
 * PDF Page Dimensions Helper
 * 
 * Provides functions to get PDF page dimensions using MuPDF engine.
 * This is used by signed PDF processing to validate page sizes.
 */

import { getMuPdfDocument, getPageBounds } from "./engines/mupdfEngine";

/**
 * Get actual PDF page dimensions in points for a specific page.
 * 
 * @param pdfBuffer PDF buffer
 * @param pageNumber Page number (1-based)
 * @returns Page dimensions in points, or null if unavailable
 */
export async function getPdfPageDimensionsPt(
  pdfBuffer: Buffer,
  pageNumber: number
): Promise<{ pageWidthPt: number; pageHeightPt: number } | null> {
  try {
    const Document = await getMuPdfDocument();
    const pdfUint8Array = new Uint8Array(pdfBuffer);
    const doc = Document.openDocument(pdfUint8Array, "application/pdf");
    
    if (!doc) {
      return null;
    }

    const docPageCount = doc.countPages();
    if (pageNumber < 1 || pageNumber > docPageCount) {
      return null;
    }

    const pdfPage = doc.loadPage(pageNumber - 1);
    if (!pdfPage) {
      return null;
    }

    const boundsPt = getPageBounds(pdfPage);
    const pageWidthPt = Math.ceil(boundsPt.x1 - boundsPt.x0);
    const pageHeightPt = Math.ceil(boundsPt.y1 - boundsPt.y0);

    return { pageWidthPt, pageHeightPt };
  } catch (error) {
    // If MuPDF is unavailable or fails, return null
    console.warn("[getPdfPageDimensionsPt] Failed to get page dimensions:", error);
    return null;
  }
}

/**
 * Get PDF page bounds for a specific page.
 * 
 * @param pdfBuffer PDF buffer
 * @param pageNumber Page number (1-based)
 * @returns Page bounds in points, or null if unavailable
 */
export async function getPdfPageBounds(
  pdfBuffer: Buffer,
  pageNumber: number
): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  try {
    const Document = await getMuPdfDocument();
    const pdfUint8Array = new Uint8Array(pdfBuffer);
    const doc = Document.openDocument(pdfUint8Array, "application/pdf");
    
    if (!doc) {
      return null;
    }

    const docPageCount = doc.countPages();
    if (pageNumber < 1 || pageNumber > docPageCount) {
      return null;
    }

    const pdfPage = doc.loadPage(pageNumber - 1);
    if (!pdfPage) {
      return null;
    }

    return getPageBounds(pdfPage);
  } catch (error) {
    // If MuPDF is unavailable or fails, return null
    console.warn("[getPdfPageBounds] Failed to get page bounds:", error);
    return null;
  }
}

