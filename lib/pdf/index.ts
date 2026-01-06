/**
 * PDF Module - Public API
 * 
 * This is the single channel for all PDF operations.
 * All PDF-related functionality is accessed through this module.
 * 
 * MuPDF engine isolation: All MuPDF operations go through lib/pdf/engines/mupdfEngine.ts
 * which is the ONLY file allowed to import "mupdf".
 */

// Re-export render function
export { renderPdfPageToPng } from "./renderPdfPage";

// Re-export normalization function
export { normalizePdfBuffer } from "./normalizePdf";

// Re-export raster detection (from templates module, uses pdf-parse, not MuPDF)
export { detectRasterOnlyPdf } from "@/lib/templates";

// Re-export page dimension helpers
export { getPdfPageDimensionsPt, getPdfPageBounds } from "./pageDimensions";

// Re-export intent policy (for routes that need it)
export { parsePdfIntent, resolvePdfIntentPolicy, type PdfIntent, type PdfIntentPolicy } from "./intent";

