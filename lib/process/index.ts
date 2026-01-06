/**
 * Process Access Layer - Main Entry Point
 * 
 * This module provides a unified API for all processing operations:
 * - PDF rendering and raster detection
 * - OCR work order number extraction
 * - Work order processing (signed PDFs, Gmail batch)
 * 
 * WIRING MAP:
 * 
 * PDF Operations:
 *   - app/api/pdf/render-page/route.ts -> renderPdfPage()
 *   - app/api/pdf/detect-raster/route.ts -> detectRasterOnlyPdf()
 * 
 * OCR Operations:
 *   - app/api/ocr/test-extract/route.ts -> ocrWorkOrderNumberFromUpload()
 *   - app/onboarding/templates/page.tsx -> (via API route)
 *   - app/pro/template-zones/page.tsx -> (via API route)
 * 
 * Work Order Processing:
 *   - app/api/signed/process/route.ts -> processSignedPdf()
 *   - app/api/signed/gmail/process/route.ts -> processSignedPdf() (per attachment)
 *   - lib/workOrders/signedProcessor.ts -> (legacy, may call processSignedPdf internally)
 * 
 * All operations use PDF Intent policy (lib/pdf/intent.ts) for consistent behavior.
 * All template operations use PDF points coordinate system (canonical format).
 */

// PDF operations
export { renderPdfPage, detectRasterOnlyPdf } from "./pdf";

// OCR operations
export { ocrWorkOrderNumberFromUpload } from "./ocr";

// Work order processing
export { processSignedPdf, processWorkOrdersFromGmail } from "./workOrders";

// Types
export type { PdfInput, RegionPoints } from "./types";
export { pdfInputToBuffer } from "./types";

