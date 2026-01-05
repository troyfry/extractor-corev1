/**
 * PDF.js utility functions for extracting page dimensions and bounds.
 * 
 * These functions extract coordinate information from PDF.js page objects
 * for use in template capture and coordinate conversion.
 */

/**
 * Extract page dimensions and bounds from PDF.js page.view array.
 * 
 * PDF.js page.view is an array: [xMin, yMin, xMax, yMax] in PDF points.
 * This function extracts:
 * - pageWidthPt: width in points (xMax - xMin)
 * - pageHeightPt: height in points (yMax - yMin)
 * - boundsPt: bounds object { x0, y0, x1, y1 }
 * 
 * @param pageView PDF.js page.view array: [xMin, yMin, xMax, yMax]
 * @returns Object with pageWidthPt, pageHeightPt, and boundsPt
 * @throws Error if pageView is invalid
 */
export function extractPdfJsPageDimensions(pageView: [number, number, number, number]): {
  pageWidthPt: number;
  pageHeightPt: number;
  boundsPt: { x0: number; y0: number; x1: number; y1: number };
} {
  if (!Array.isArray(pageView) || pageView.length !== 4) {
    throw new Error("pageView must be an array of 4 numbers: [xMin, yMin, xMax, yMax]");
  }

  const [x0, y0, x1, y1] = pageView;

  // Validate all values are numbers
  if (
    typeof x0 !== "number" ||
    typeof y0 !== "number" ||
    typeof x1 !== "number" ||
    typeof y1 !== "number"
  ) {
    throw new Error("pageView must contain only numbers");
  }

  // Validate bounds are valid (x1 > x0, y1 > y0)
  if (x1 <= x0 || y1 <= y0) {
    throw new Error(`Invalid page bounds: x1 (${x1}) must be > x0 (${x0}), y1 (${y1}) must be > y0 (${y0})`);
  }

  const widthPt = x1 - x0;
  const heightPt = y1 - y0;

  return {
    pageWidthPt: widthPt,
    pageHeightPt: heightPt,
    boundsPt: { x0, y0, x1, y1 },
  };
}

