/**
 * Domain layer: Coordinate conversion barrel export.
 * 
 * Provides a single import point for all coordinate-related domain functions.
 */

// Re-export everything from pdfPoints
export {
  cssPixelsToPdfPoints,
  pdfPointsToCssPixels,
  validatePdfPoints,
  assertPdfCropPointsValid,
  type PdfPoints,
  type CssPixels,
  type BoundsPt,
  type PdfCropPoints,
  type CanvasPixels,
  type PdfPageGeometry,
} from "./pdfPoints";

// Re-export assertion wrapper
export { assertPtSanity } from "./assert";

