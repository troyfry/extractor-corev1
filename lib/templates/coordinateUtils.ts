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
 * PDF page bounds in points (from MuPDF getBounds()).
 * MuPDF bounds may not start at (0,0), so we need to normalize.
 */
export type BoundsPt = { x0: number; y0: number; x1: number; y1: number };

/**
 * Convert natural pixel coordinates to PDF points using proportional mapping.
 * 
 * IMPORTANT: MuPDF page.getBounds() is not guaranteed to start at (0,0).
 * To get 0-based page coordinates, we must subtract boundsPt.x0/y0.
 * 
 * @param nat - Natural pixel coordinates
 * @param naturalW - Natural image width in pixels
 * @param naturalH - Natural image height in pixels
 * @param pageWidthPt - Page width in points (x1 - x0 from bounds)
 * @param pageHeightPt - Page height in points (y1 - y0 from bounds)
 * @param boundsPt - Optional bounds from MuPDF getBounds() to normalize coordinates
 */
export function naturalPxToPdfPoints(
  nat: { x: number; y: number; w: number; h: number },
  naturalW: number,
  naturalH: number,
  pageWidthPt: number,
  pageHeightPt: number,
  boundsPt?: BoundsPt | null
): { xPt: number; yPt: number; wPt: number; hPt: number } {
  const x0 = boundsPt?.x0 ?? 0;
  const y0 = boundsPt?.y0 ?? 0;

  const xNorm = nat.x / naturalW;
  const yNorm = nat.y / naturalH;
  const wNorm = nat.w / naturalW;
  const hNorm = nat.h / naturalH;

  // ✅ Normalize bounds -> 0-based page space
  const xPt = xNorm * pageWidthPt - x0;
  const yPt = yNorm * pageHeightPt - y0;
  const wPt = wNorm * pageWidthPt;
  const hPt = hNorm * pageHeightPt;

  return { xPt, yPt, wPt, hPt };
}

/**
 * Assert that PDF point coordinates are sane.
 * This prevents regressions where coordinates get corrupted.
 * 
 * Generic validation that catches drift without FM-specific rules.
 * 
 * @param pts - PDF point coordinates to validate
 * @param pageWidthPt - Page width in points
 * @param pageHeightPt - Page height in points
 * @param label - Optional label for error messages (default: "crop")
 */
export function assertPtSanity(
  pts: { xPt: number; yPt: number; wPt: number; hPt: number },
  pageWidthPt: number,
  pageHeightPt: number,
  label = "crop"
): void {
  const { xPt, yPt, wPt, hPt } = pts;

  const ok =
    Number.isFinite(xPt) && Number.isFinite(yPt) &&
    Number.isFinite(wPt) && Number.isFinite(hPt) &&
    wPt > 0 && hPt > 0 &&
    xPt >= 0 && yPt >= 0 &&
    xPt + wPt <= pageWidthPt + 1 &&   // small tolerance
    yPt + hPt <= pageHeightPt + 1;

  if (!ok) {
    throw new Error(
      `[${label}] Invalid PDF_POINTS crop. Got x=${xPt},y=${yPt},w=${wPt},h=${hPt} ` +
      `page=${pageWidthPt}x${pageHeightPt}`
    );
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

