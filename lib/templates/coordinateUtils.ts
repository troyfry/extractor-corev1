/**
 * Coordinate conversion utilities for template configuration.
 * 
 * GOLDEN RULE: All saved template coordinates must be derived from PDF POINT SPACE
 * - Never pixels, never DPI
 * - Use simple proportional math: xPt = (cropX / imgW) * pageWidthPt
 */

/**
 * Assert that PDF point coordinates are sane.
 * This prevents regressions where coordinates get corrupted.
 */
/**
 * Convert CSS crop coordinates to natural pixel coordinates.
 * Accounts for image scaling (displayed size vs natural size).
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
 * Convert natural pixel coordinates to PDF points using proportional mapping.
 */
export function naturalPxToPdfPoints(
  nat: { x: number; y: number; w: number; h: number },
  naturalWidth: number,
  naturalHeight: number,
  pageWidthPt: number,
  pageHeightPt: number
): { xPt: number; yPt: number; wPt: number; hPt: number } {
  return {
    xPt: (nat.x / naturalWidth) * pageWidthPt,
    yPt: (nat.y / naturalHeight) * pageHeightPt,
    wPt: (nat.w / naturalWidth) * pageWidthPt,
    hPt: (nat.h / naturalHeight) * pageHeightPt,
  };
}

/**
 * Assert that PDF point coordinates are sane.
 * This prevents regressions where coordinates get corrupted.
 * 
 * @param label - Label for error messages (e.g., "Superclean")
 * @param pts - PDF point coordinates to validate
 * @param fmKeyNormalized - Optional normalized FM key for special validation (e.g., "superclean")
 */
export function assertPtSanity(
  label: string,
  pts: {
    xPt: number;
    yPt: number;
    wPt: number;
    hPt: number;
    pageWidthPt: number;
    pageHeightPt: number;
  },
  fmKeyNormalized?: string
): void {
  if (pts.xPt < 0 || pts.yPt < 0 || pts.wPt <= 0 || pts.hPt <= 0) {
    throw new Error(`[${label}] Invalid points: negative/zero`);
  }
  if (pts.xPt + pts.wPt > pts.pageWidthPt + 1) {
    throw new Error(`[${label}] Crop exceeds page width`);
  }
  if (pts.yPt + pts.hPt > pts.pageHeightPt + 1) {
    throw new Error(`[${label}] Crop exceeds page height`);
  }

  // Special validation for Superclean
  if (fmKeyNormalized && fmKeyNormalized.includes("superclean") && (pts.xPt < 430 || pts.xPt > 475)) {
    throw new Error(`[superclean] xPt out of expected range: ${pts.xPt}`);
  }
}

/**
 * Convert CSS pixel coordinates to PDF points using simple proportional math.
 * 
 * GOLDEN RULE: Use PDF page dimensions (points) as source of truth.
 * 
 * IMPORTANT: Accounts for natural vs displayed image dimensions.
 * If the image is scaled down for display (CSS max-width, responsive layout, etc.),
 * crop coordinates must be converted to natural pixels first, then to PDF points.
 * 
 * This prevents coordinate drift when images are scaled for display.
 * 
 * Formula:
 *   xPt = (xNaturalPx / naturalWidthPx) * pageWidthPt
 *   yPt = (yNaturalPx / naturalHeightPx) * pageHeightPt
 * 
 * @param cropCss - Crop box in CSS pixels (from overlay in CSS px)
 * @param displayed - Displayed size from getBoundingClientRect()
 * @param natural - Natural image size from img.naturalWidth/Height
 * @param pagePt - PDF page dimensions in points from MuPDF getBounds()
 * @returns PDF point coordinates in TOP-LEFT origin
 */
export function cssCropToPdfPoints(args: {
  cropCss: { x: number; y: number; w: number; h: number }; // CSS px relative to displayed image
  displayed: { w: number; h: number }; // getBoundingClientRect size
  natural: { w: number; h: number };   // img.naturalWidth / naturalHeight
  pagePt: { w: number; h: number };    // from MuPDF getBounds()
}): { xPt: number; yPt: number; wPt: number; hPt: number } {
  const { cropCss, displayed, natural, pagePt } = args;

  // CSS px -> natural px
  const scaleX = natural.w / displayed.w;
  const scaleY = natural.h / displayed.h;

  const xNat = cropCss.x * scaleX;
  const yNat = cropCss.y * scaleY;
  const wNat = cropCss.w * scaleX;
  const hNat = cropCss.h * scaleY;

  // natural px -> PDF points (proportional)
  const xPt = (xNat / natural.w) * pagePt.w;
  const yPt = (yNat / natural.h) * pagePt.h;
  const wPt = (wNat / natural.w) * pagePt.w;
  const hPt = (hNat / natural.h) * pagePt.h;

  return { xPt, yPt, wPt, hPt };
}

