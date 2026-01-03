/**
 * ⚠️⚠️⚠️ CRITICAL: DO NOT MODIFY THIS FILE ⚠️⚠️⚠️
 * 
 * This file contains the LOCKED coordinate conversion logic for template capture zones.
 * This logic has been extensively tested and debugged to ensure accurate coordinate
 * conversion between CSS pixels, canvas pixels, and PDF points.
 * 
 * ANY CHANGES TO THIS FILE WILL BREAK TEMPLATE COORDINATE ACCURACY.
 * 
 * If you need to modify coordinate conversion logic:
 * 1. Create a NEW function/file for your changes
 * 2. Test extensively with multiple PDFs and FM profiles
 * 3. Only replace this file after thorough validation
 * 
 * Last validated: 2024-12-19
 * Tested with: superclean, 23rd group, and other FM profiles
 * 
 * ============================================================================
 * COORDINATE CONVERSION ARCHITECTURE
 * ============================================================================
 * 
 * The coordinate system uses a THREE-STEP conversion process:
 * 
 * 1. CSS PIXELS (User Interface)
 *    - Coordinates from getBoundingClientRect() when user draws rectangle
 *    - Represents displayed image size (may be scaled by CSS)
 *    - Stored in: cropZone state { x, y, width, height }
 * 
 * 2. CANVAS PIXELS (Rendered Image)
 *    - Actual pixel dimensions of rendered PDF page image
 *    - For pdf.js: viewport.width/height (scale 2.0 = 2x resolution)
 *    - For MuPDF: width/height from renderPdfPageToPng()
 *    - Stored in: imageWidth, imageHeight state
 * 
 * 3. PDF POINTS (Persistent Storage)
 *    - Absolute PDF coordinate space (72 points = 1 inch)
 *    - Normalized to 0-based coordinates (accounts for PDF bounds offset)
 *    - Stored in: Google Sheets (xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt)
 * 
 * ============================================================================
 * BOUNDS NORMALIZATION (CRITICAL)
 * ============================================================================
 * 
 * PDF pages may have bounds that don't start at (0,0). For example:
 * - page.view in pdf.js: [xMin, yMin, xMax, yMax] where xMin/yMin may be non-zero
 * - MuPDF getBounds(): { x0, y0, x1, y1 } where x0/y0 may be non-zero
 * 
 * To ensure consistent 0-based coordinates:
 * - When SAVING: Subtract boundsPt.x0/y0 from calculated points
 * - When LOADING: Add boundsPt.x0/y0 back to saved points before conversion
 * 
 * This normalization ensures coordinates work correctly across different PDFs.
 * 
 * ============================================================================
 * CONVERSION FLOW
 * ============================================================================
 * 
 * SAVING (CSS → PDF Points):
 *   1. CSS pixels → Canvas pixels (scale by imageWidth/rect.width)
 *   2. Canvas pixels → PDF points (proportional: canvasPx/canvasSize * pageSizePt)
 *   3. Normalize bounds (subtract boundsPt.x0/y0)
 * 
 * LOADING (PDF Points → CSS):
 *   1. Denormalize bounds (add boundsPt.x0/y0 to saved points)
 *   2. PDF points → Canvas pixels (proportional: point/pageSizePt * canvasSize)
 *   3. Canvas pixels → CSS pixels (scale by rect.width/imageWidth)
 * 
 * ============================================================================
 */

/**
 * PDF page bounds in points.
 * 
 * IMPORTANT: PDF page bounds may not start at (0,0).
 * - pdf.js: page.view = [xMin, yMin, xMax, yMax]
 * - MuPDF: page.getBounds() = { x0, y0, x1, y1 }
 * 
 * We normalize coordinates to 0-based by subtracting x0/y0.
 */
export type BoundsPt = {
  x0: number; // Left edge of page bounds (may be non-zero)
  y0: number; // Top edge of page bounds (may be non-zero)
  x1: number; // Right edge of page bounds
  y1: number; // Bottom edge of page bounds
};

/**
 * CSS pixel coordinates (from user interface).
 * These are the coordinates the user sees and interacts with.
 */
export type CssPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Canvas pixel coordinates (from rendered image).
 * These are the actual pixel dimensions of the rendered PDF page.
 */
export type CanvasPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * PDF point coordinates (persistent storage).
 * These are normalized to 0-based coordinates (bounds offset removed).
 */
export type PdfPoints = {
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
};

/**
 * ⚠️ LOCKED FUNCTION: CSS Pixels → PDF Points (SAVING)
 * 
 * Converts user-drawn rectangle (CSS pixels) to PDF points for storage.
 * 
 * This is the EXACT conversion used when saving templates. DO NOT MODIFY.
 * 
 * @param cssPx - Rectangle coordinates in CSS pixels (from cropZone state)
 * @param displayedRect - Displayed image size from getBoundingClientRect()
 * @param canvasSize - Actual rendered image size (imageWidth, imageHeight)
 * @param pageSizePt - PDF page size in points (pageWidthPt, pageHeightPt)
 * @param boundsPt - Optional PDF page bounds for normalization
 * @returns PDF point coordinates normalized to 0-based space
 * 
 * CONVERSION STEPS:
 * 1. CSS pixels → Canvas pixels: cssPx * (canvasSize / displayedRect)
 * 2. Canvas pixels → PDF points: (canvasPx / canvasSize) * pageSizePt
 * 3. Normalize bounds: pdfPt - boundsPt.x0/y0
 */
export function cssPixelsToPdfPoints(
  cssPx: CssPixels,
  displayedRect: { width: number; height: number },
  canvasSize: { width: number; height: number },
  pageSizePt: { width: number; height: number },
  boundsPt?: BoundsPt | null
): PdfPoints {
  // ⚠️ DO NOT MODIFY THIS CONVERSION LOGIC
  
  // Step 1: CSS pixels → Canvas pixels
  // Account for CSS scaling (image may be displayed smaller than natural size)
  const scaleX = canvasSize.width / displayedRect.width;
  const scaleY = canvasSize.height / displayedRect.height;
  
  const xCanvas = cssPx.x * scaleX;
  const yCanvas = cssPx.y * scaleY;
  const wCanvas = cssPx.width * scaleX;
  const hCanvas = cssPx.height * scaleY;
  
  // Step 2: Canvas pixels → PDF points (proportional conversion)
  // This is the core conversion: PDF points are proportional to page size
  const xNorm = xCanvas / canvasSize.width;
  const yNorm = yCanvas / canvasSize.height;
  const wNorm = wCanvas / canvasSize.width;
  const hNorm = hCanvas / canvasSize.height;
  
  // Calculate in bounds space first
  const xPtBoundsSpace = xNorm * pageSizePt.width;
  const yPtBoundsSpace = yNorm * pageSizePt.height;
  const wPt = wNorm * pageSizePt.width;
  const hPt = hNorm * pageSizePt.height;
  
  // Step 3: Normalize bounds → 0-based page space
  // CRITICAL: Subtract bounds offset to get 0-based coordinates
  const x0 = boundsPt?.x0 ?? 0;
  const y0 = boundsPt?.y0 ?? 0;
  
  const xPt = xPtBoundsSpace - x0;
  const yPt = yPtBoundsSpace - y0;
  
  return { xPt, yPt, wPt, hPt };
}

/**
 * ⚠️ LOCKED FUNCTION: PDF Points → CSS Pixels (LOADING)
 * 
 * Converts saved PDF points back to CSS pixels for display.
 * 
 * This is the EXACT REVERSE of cssPixelsToPdfPoints(). DO NOT MODIFY.
 * 
 * @param pdfPt - Saved PDF point coordinates (normalized, 0-based)
 * @param savedPageSizePt - Page size that was used when saving (savedTemplate.pageWidthPt/pageHeightPt)
 * @param currentCanvasSize - Current rendered image size (imageWidth, imageHeight)
 * @param currentDisplayedRect - Current displayed image size from getBoundingClientRect()
 * @param boundsPt - Current PDF page bounds for denormalization
 * @returns CSS pixel coordinates for display
 * 
 * CONVERSION STEPS (REVERSE OF SAVING):
 * 1. Denormalize bounds: pdfPt + boundsPt.x0/y0
 * 2. PDF points → Canvas pixels: (pdfPt / savedPageSizePt) * currentCanvasSize
 * 3. Canvas pixels → CSS pixels: canvasPx * (currentDisplayedRect / currentCanvasSize)
 * 
 * CRITICAL: Use SAVED page dimensions (savedPageSizePt), not current page dimensions.
 * Coordinates were saved relative to those dimensions, so we must use them to convert back.
 */
export function pdfPointsToCssPixels(
  pdfPt: PdfPoints,
  savedPageSizePt: { width: number; height: number },
  currentCanvasSize: { width: number; height: number },
  currentDisplayedRect: { width: number; height: number },
  boundsPt?: BoundsPt | null
): CssPixels {
  // ⚠️ DO NOT MODIFY THIS CONVERSION LOGIC
  
  // Step 1: Denormalize bounds → bounds space coordinates
  // CRITICAL: Add bounds offset back (reverse of normalization during save)
  const x0 = boundsPt?.x0 ?? 0;
  const y0 = boundsPt?.y0 ?? 0;
  
  const xPtBoundsSpace = pdfPt.xPt + x0;
  const yPtBoundsSpace = pdfPt.yPt + y0;
  
  // Step 2: PDF points → Canvas pixels (using SAVED page dimensions)
  // CRITICAL: Use savedPageSizePt, not current page size
  // Coordinates were saved relative to these dimensions
  const xNorm = xPtBoundsSpace / savedPageSizePt.width;
  const yNorm = yPtBoundsSpace / savedPageSizePt.height;
  const wNorm = pdfPt.wPt / savedPageSizePt.width;
  const hNorm = pdfPt.hPt / savedPageSizePt.height;
  
  const xCanvas = xNorm * currentCanvasSize.width;
  const yCanvas = yNorm * currentCanvasSize.height;
  const wCanvas = wNorm * currentCanvasSize.width;
  const hCanvas = hNorm * currentCanvasSize.height;
  
  // Step 3: Canvas pixels → CSS pixels (account for CSS scaling)
  const scaleX = currentDisplayedRect.width / currentCanvasSize.width;
  const scaleY = currentDisplayedRect.height / currentCanvasSize.height;
  
  const xCss = xCanvas * scaleX;
  const yCss = yCanvas * scaleY;
  const wCss = wCanvas * scaleX;
  const hCss = hCanvas * scaleY;
  
  return {
    x: xCss,
    y: yCss,
    width: wCss,
    height: hCss,
  };
}

/**
 * ⚠️ LOCKED FUNCTION: Validation
 * 
 * Validates PDF point coordinates are within bounds and finite.
 * 
 * DO NOT MODIFY validation logic without extensive testing.
 */
export function validatePdfPoints(
  pdfPt: PdfPoints,
  pageSizePt: { width: number; height: number },
  label = "crop"
): void {
  const { xPt, yPt, wPt, hPt } = pdfPt;
  
  const isValid =
    Number.isFinite(xPt) && Number.isFinite(yPt) &&
    Number.isFinite(wPt) && Number.isFinite(hPt) &&
    wPt > 0 && hPt > 0 &&
    xPt >= 0 && yPt >= 0 &&
    xPt + wPt <= pageSizePt.width + 1 &&   // small tolerance for rounding
    yPt + hPt <= pageSizePt.height + 1;
  
  if (!isValid) {
    throw new Error(
      `[${label}] Invalid PDF_POINTS coordinates. ` +
      `Got x=${xPt}, y=${yPt}, w=${wPt}, h=${hPt} ` +
      `page=${pageSizePt.width}x${pageSizePt.height}`
    );
  }
}

