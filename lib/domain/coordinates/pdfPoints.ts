/**
 * Domain layer: PDF coordinate conversion functions.
 * 
 * This module re-exports coordinate conversion functions from the templates layer.
 * It provides a stable import path for domain-level coordinate operations.
 * 
 * DO NOT modify the underlying conversion logic - this is a pure re-export wrapper.
 */

// Re-export conversion functions
export {
  cssPixelsToPdfPoints,
  pdfPointsToCssPixels,
  validatePdfPoints,
  assertPdfCropPointsValid,
} from "@/lib/templates/templateCoordinateConversion";

// Re-export types
export type {
  PdfPoints,
  CssPixels,
  BoundsPt,
  PdfCropPoints,
  CanvasPixels,
  PdfPageGeometry,
} from "@/lib/templates/templateCoordinateConversion";
