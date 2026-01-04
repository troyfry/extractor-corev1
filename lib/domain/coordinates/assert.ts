/**
 * Domain layer: PDF coordinate validation assertions.
 * 
 * Simple wrapper around validatePdfPoints for domain-level validation.
 */

import { validatePdfPoints } from "@/lib/templates/templateCoordinateConversion";
import type { PdfPoints } from "@/lib/templates/templateCoordinateConversion";

/**
 * Assert that PDF points are valid (sanity check).
 * 
 * @param pdfPt - PDF point coordinates to validate
 * @param pageSizePt - Page size in points
 * @param label - Optional label for error messages
 * @throws Error if coordinates are invalid
 */
export function assertPtSanity(
  pdfPt: PdfPoints,
  pageSizePt: { width: number; height: number },
  label?: string
): void {
  validatePdfPoints(pdfPt, pageSizePt, label);
}
