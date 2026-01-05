/**
 * Client-safe page dimension validation.
 * 
 * This module contains only client-side validation logic and does NOT import
 * any server-side dependencies (like Google Sheets API).
 * 
 * Use this module in client components instead of importing from lib/templates/index.ts
 * to avoid bundling server-side code.
 */

/**
 * Standard page sizes for template capture validation.
 * Phone photo scans and unusual PDFs have non-standard dimensions.
 */
export const STANDARD_PAGE_SIZES = [
  { name: "Letter", width: 612, height: 792, tolerance: 5 },
  { name: "A4", width: 595.276, height: 841.890, tolerance: 5 },
  { name: "Legal", width: 612, height: 1008, tolerance: 5 },
  { name: "Tabloid", width: 792, height: 1224, tolerance: 5 },
  // Also check landscape orientations
  { name: "Letter (landscape)", width: 792, height: 612, tolerance: 5 },
  { name: "A4 (landscape)", width: 841.890, height: 595.276, tolerance: 5 },
  { name: "Legal (landscape)", width: 1008, height: 612, tolerance: 5 },
  { name: "Tabloid (landscape)", width: 1224, height: 792, tolerance: 5 },
] as const;

/**
 * Check if page dimensions match a standard page size.
 * Used to reject phone photo scans and unusual PDFs that have non-standard dimensions.
 * 
 * @param pageWidthPt - Page width in PDF points
 * @param pageHeightPt - Page height in PDF points
 * @returns Object with `isStandard` boolean and `matchedSize` name if matched
 */
export function validatePageDimensions(
  pageWidthPt: number,
  pageHeightPt: number
): { isStandard: boolean; matchedSize?: string } {
  const matchesStandard = STANDARD_PAGE_SIZES.some(page => {
    const widthMatch = Math.abs(pageWidthPt - page.width) <= page.tolerance;
    const heightMatch = Math.abs(pageHeightPt - page.height) <= page.tolerance;
    return widthMatch && heightMatch;
  });

  if (matchesStandard) {
    const matched = STANDARD_PAGE_SIZES.find(page => {
      const widthMatch = Math.abs(pageWidthPt - page.width) <= page.tolerance;
      const heightMatch = Math.abs(pageHeightPt - page.height) <= page.tolerance;
      return widthMatch && heightMatch;
    });
    return { isStandard: true, matchedSize: matched?.name };
  }

  return { isStandard: false };
}

