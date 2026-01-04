/**
 * ⚠️ DEPRECATED: This file is now a re-export wrapper.
 * 
 * All coordinate conversion logic has been moved to templateCoordinateConversion.ts
 * as the SINGLE SOURCE OF TRUTH.
 * 
 * This file exists only for backward compatibility.
 * DO NOT ADD NEW LOGIC HERE.
 * 
 * Import directly from templateCoordinateConversion.ts instead.
 */

// Re-export all types and functions from the locked conversion module
export {
  type BoundsPt,
  type CssPixels,
  type CanvasPixels,
  type PdfPoints,
  type PdfPageGeometry,
  type PdfCropPoints,
  cssPixelsToPdfPoints,
  pdfPointsToCssPixels,
  validatePdfPoints,
  assertPdfCropPointsValid,
} from "./templateCoordinateConversion";

/**
 * @deprecated Use cssPixelsToPdfPoints from templateCoordinateConversion.ts
 * This function is kept for backward compatibility only.
 */
export function cssCropToNaturalPx(
  imgEl: HTMLImageElement,
  cropCss: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  const rect = imgEl.getBoundingClientRect();
  const scaleX = imgEl.naturalWidth / rect.width;
  const scaleY = imgEl.naturalHeight / rect.height;
  return {
    x: cropCss.x * scaleX,
    y: cropCss.y * scaleY,
    w: cropCss.w * scaleX,
    h: cropCss.h * scaleY,
  };
}

/**
 * @deprecated Use cssPixelsToPdfPoints from templateCoordinateConversion.ts
 * This function is kept for backward compatibility only.
 */
export function naturalPxToPdfPoints(
  nat: { x: number; y: number; w: number; h: number },
  naturalW: number,
  naturalH: number,
  pageWidthPt: number,
  pageHeightPt: number,
  boundsPt?: { x0: number; y0: number; x1: number; y1: number } | null
): { xPt: number; yPt: number; wPt: number; hPt: number } {
  // Delegate to the locked conversion function
  const { cssPixelsToPdfPoints } = require("./templateCoordinateConversion");
  
  // Convert natural px to CSS px (1:1 ratio for this case)
  // Then use the locked conversion function
  return cssPixelsToPdfPoints(
    {
      x: nat.x,
      y: nat.y,
      width: nat.w,
      height: nat.h,
    },
    { width: naturalW, height: naturalH }, // displayed = natural in this case
    { width: naturalW, height: naturalH }, // canvas = natural
    { width: pageWidthPt, height: pageHeightPt },
    boundsPt ?? null
  );
}

/**
 * @deprecated Use assertPdfCropPointsValid from templateCoordinateConversion.ts
 * This function is kept for backward compatibility only.
 */
export function assertPtSanity(
  pts: { xPt: number; yPt: number; wPt: number; hPt: number },
  pageWidthPt: number,
  pageHeightPt: number,
  label = "crop"
): void {
  const { validatePdfPoints } = require("./templateCoordinateConversion");
  validatePdfPoints(pts, { width: pageWidthPt, height: pageHeightPt }, label);
}

/**
 * @deprecated Use cssPixelsToPdfPoints from templateCoordinateConversion.ts
 * This function is kept for backward compatibility only.
 */
export function cssCropToPdfPoints(args: {
  cropCss: { x: number; y: number; w: number; h: number };
  displayed: { w: number; h: number };
  natural: { w: number; h: number };
  pagePt: { w: number; h: number };
}): { xPt: number; yPt: number; wPt: number; hPt: number } {
  const { cssPixelsToPdfPoints } = require("./templateCoordinateConversion");
  return cssPixelsToPdfPoints(
    {
      x: args.cropCss.x,
      y: args.cropCss.y,
      width: args.cropCss.w,
      height: args.cropCss.h,
    },
    { width: args.displayed.w, height: args.displayed.h },
    { width: args.natural.w, height: args.natural.h },
    { width: args.pagePt.w, height: args.pagePt.h },
    null // boundsPt not provided in old API
  );
}
