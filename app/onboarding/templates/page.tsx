"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Coordinate system constants
// Internal: use PDF_POINTS_TOP_LEFT to be explicit about origin
// Sheet storage: use PDF_POINTS (legacy compatibility)
const COORD_SYSTEM_PDF_POINTS_TOP_LEFT = "PDF_POINTS_TOP_LEFT";
const COORD_SYSTEM_SHEET_VALUE = "PDF_POINTS"; // Value stored in sheets

// Helper to normalize coordSystem from sheet (PDF_POINTS -> PDF_POINTS_TOP_LEFT)
function normalizeCoordSystem(coordSystem?: string): string | undefined {
  if (coordSystem === COORD_SYSTEM_SHEET_VALUE) {
    return COORD_SYSTEM_PDF_POINTS_TOP_LEFT;
  }
  return coordSystem;
}

// Helper to convert internal coordSystem to sheet value
function toSheetCoordSystem(coordSystem?: string): string {
  if (coordSystem === COORD_SYSTEM_PDF_POINTS_TOP_LEFT) {
    return COORD_SYSTEM_SHEET_VALUE;
  }
  return coordSystem || "";
}

// pdf.js - will be loaded dynamically using ESM legacy build
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLibPromise: Promise<any> | null = null;

// Shared helper to initialize pdf.js (used by both useEffect and handleFileUpload)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function initPdfJsLib(): Promise<any> {
  // Only run in browser
  if (typeof window === "undefined") {
    throw new Error("PDF.js can only be initialized in the browser");
  }

  if (pdfjsLibPromise) {
    return pdfjsLibPromise;
  }

  pdfjsLibPromise = (async () => {
    try {
      // Import pdfjs-dist ESM legacy build
      const pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
      
      // Handle default export fallback
      const pdfjsLib = pdfjsModule.default ?? pdfjsModule;
      
      // Configure worker to use file from /public
      if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      }
      
      // Verify getDocument is available
      if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
        throw new Error("PDF.js getDocument function not found");
      }
      
      console.log("[PDF.js] Initialized successfully with ESM legacy build");
      return pdfjsLib;
    } catch (error) {
      console.error("[PDF.js] Failed to initialize:", error);
      pdfjsLibPromise = null; // Reset on error so we can retry
      throw error;
    }
  })();

  return pdfjsLibPromise;
}

type FmProfile = {
  fmKey: string;
  fmLabel: string;
};

type Template = {
  userId: string;
  fmKey: string;
  templateId: string;
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  dpi?: number;
  // New PDF points fields (optional for backward compatibility)
  coordSystem?: string;
  pageWidthPt?: number;
  pageHeightPt?: number;
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  updated_at: string;
};

type CropZone = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function OnboardingTemplatesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fmProfiles, setFmProfiles] = useState<FmProfile[]>([]);
  const [selectedFmKey, setSelectedFmKey] = useState<string>("");
  const [_pdfFile, setPdfFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState<number>(0);
  const [imageHeight, setImageHeight] = useState<number>(0);
  const [pageWidthPt, setPageWidthPt] = useState<number>(0);
  const [pageHeightPt, setPageHeightPt] = useState<number>(0);
  const [boundsPt, setBoundsPt] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [cropZone, setCropZone] = useState<CropZone | null>(null);
  // Store the viewport used for rendering (needed for accurate pixel->PDF point conversion)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [currentViewport, setCurrentViewport] = useState<any>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [_isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState<Template | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [pageCount, setPageCount] = useState<number>(0);
  const [coordsPage, setCoordsPage] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const hasInitializedFromQuery = useRef<boolean>(false);
  const [manualCoords, setManualCoords] = useState<{ xPct: string; yPct: string; wPct: string; hPct: string } | null>(null);
  const [manualPoints, setManualPoints] = useState<{ xPt: string; yPt: string; wPt: string; hPt: string } | null>(null);
  const [calculatedPoints, setCalculatedPoints] = useState<{ xPt: number; yPt: number; wPt: number; hPt: number } | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Auto-select fmKey from query parameter (will be validated after profiles load)
  useEffect(() => {
    if (hasInitializedFromQuery.current) return; // Don't override after user selection
    
    const fmKeyFromQuery = searchParams.get("fmKey");
    if (fmKeyFromQuery) {
      // Store it, but validation happens in loadFmProfiles after profiles are loaded
      hasInitializedFromQuery.current = true;
    }
  }, [searchParams]);

  // Initialize pdf.js on mount
  useEffect(() => {
    initPdfJsLib().catch(() => {
      // Error already logged in helper
    });
  }, []);

  // Load FM profiles on mount
  useEffect(() => {
    loadFmProfiles();
  }, []);

  // Load existing template when fmKey changes
  useEffect(() => {
    if (selectedFmKey) {
      loadExistingTemplate();
    } else {
      setCropZone(null);
      setSavedTemplate(null);
    }
  }, [selectedFmKey]);

  // When image loads, convert saved template to pixels (only if on the correct page)
  // Prefer PDF points if available, otherwise fallback to percentages
  useEffect(() => {
    if (previewImage && imageWidth > 0 && imageHeight > 0 && savedTemplate && savedTemplate.page === selectedPage) {
      // If template has PDF points and we have page dimensions, use points → pixels conversion
      const normalizedCoordSystem = normalizeCoordSystem(savedTemplate.coordSystem);
      if (normalizedCoordSystem === COORD_SYSTEM_PDF_POINTS_TOP_LEFT && 
          savedTemplate.pageWidthPt && savedTemplate.pageHeightPt &&
          savedTemplate.xPt !== undefined && savedTemplate.yPt !== undefined &&
          savedTemplate.wPt !== undefined && savedTemplate.hPt !== undefined &&
          pageWidthPt > 0 && pageHeightPt > 0) {
        // Convert PDF points to CSS pixels (top-left origin)
        // IMPORTANT: Templates saved with bounds normalization store xPt in 0-based space.
        // To convert back to CSS pixels, we need to add bounds offset to get bounds-space coordinates,
        // then scale proportionally to image dimensions.
        const scaleX = imageWidth / savedTemplate.pageWidthPt;
        const scaleY = imageHeight / savedTemplate.pageHeightPt;
        
        // Add bounds offset if available to convert from 0-based to bounds-space coordinates
        // This works for both:
        // - New templates: xPt is normalized (0-based), so adding x0 gives bounds-space (correct)
        // - Old templates: xPt is in bounds-space, but adding x0 still works for display conversion
        const xPtBoundsSpace = boundsPt ? savedTemplate.xPt + boundsPt.x0 : savedTemplate.xPt;
        const yPtBoundsSpace = boundsPt ? savedTemplate.yPt + boundsPt.y0 : savedTemplate.yPt;
        
        const xCss = xPtBoundsSpace * scaleX;
        const yCss = yPtBoundsSpace * scaleY;
        const wCss = savedTemplate.wPt * scaleX;
        const hCss = savedTemplate.hPt * scaleY;
        
        // Warn if template appears to be old (xPt seems too low for superclean)
        if (boundsPt && savedTemplate.fmKey?.toLowerCase().includes("superclean") && savedTemplate.xPt < 400) {
          console.warn(`[Template Load] Old template detected (xPt=${savedTemplate.xPt}). Please re-save to get correct coordinates with bounds normalization.`);
        }
        
        try {
          
          setCropZone({
            x: xCss,
            y: yCss,
            width: wCss,
            height: hCss,
          });
        } catch {
          // Image not loaded yet, will retry when image loads
          console.log("[Onboarding] Image rect not available yet for template conversion");
        }
      } else {
        // Fallback to percentage-based conversion (legacy)
        setCropZone({
          x: savedTemplate.xPct * imageWidth,
          y: savedTemplate.yPct * imageHeight,
          width: savedTemplate.wPct * imageWidth,
          height: savedTemplate.hPct * imageHeight,
        });
      }
      setCoordsPage(savedTemplate.page);
    } else if (savedTemplate && savedTemplate.page !== selectedPage) {
      // Clear crop zone if we're on a different page than the saved template
      setCropZone(null);
      setCoordsPage(null);
    }
  }, [previewImage, imageWidth, imageHeight, savedTemplate, selectedPage, pageWidthPt, pageHeightPt]);

  async function loadFmProfiles() {
    setIsLoadingProfiles(true);
    setError(null);
    try {
      const response = await fetch("/api/fm-profiles");
      if (response.ok) {
        const data = await response.json();
        const profiles = (data.profiles || []) as FmProfile[];
        setFmProfiles(profiles);
        
        // After profiles load, validate and auto-select fmKey from query param if valid
        const fmKeyFromQuery = searchParams.get("fmKey");
        if (fmKeyFromQuery && hasInitializedFromQuery.current) {
          // Check if the query param fmKey exists in the loaded profiles
          const isValidFmKey = profiles.some(p => p.fmKey === fmKeyFromQuery);
          if (isValidFmKey) {
            setSelectedFmKey(fmKeyFromQuery);
          }
          // If not valid, don't set it (user can select manually)
        } else if (profiles.length > 0 && !selectedFmKey) {
          // Auto-select first profile if no fmKey from query param and no user selection
          setSelectedFmKey(profiles[0].fmKey);
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: "Failed to load FM profiles" }));
        setError(errorData.error || "Failed to load FM profiles");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load FM profiles");
    } finally {
      setIsLoadingProfiles(false);
    }
  }

  async function loadExistingTemplate() {
    if (!selectedFmKey) return;
    
    setIsLoadingTemplate(true);
    setError(null);
    try {
      const response = await fetch(`/api/onboarding/templates/get?fmKey=${encodeURIComponent(selectedFmKey)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.template) {
          const template = data.template as Template;
          setSavedTemplate(template);
          
          // If we have a PDF loaded, navigate to the saved template's page
          if (pdfFile && template.page && template.page !== selectedPage) {
            await handlePageChange(template.page);
          }
          
          // Convert template to CSS pixel coordinates if we have an image
          // Prefer PDF points if available, otherwise fallback to percentages
          if (previewImage && template.page === selectedPage) {
          // If template has PDF points and we have page dimensions, use points → CSS pixels conversion
          const normalizedCoordSystem = normalizeCoordSystem(template.coordSystem);
          if (normalizedCoordSystem === COORD_SYSTEM_PDF_POINTS_TOP_LEFT &&
                template.pageWidthPt && template.pageHeightPt &&
                template.xPt !== undefined && template.yPt !== undefined &&
                template.wPt !== undefined && template.hPt !== undefined &&
                pageWidthPt > 0 && pageHeightPt > 0) {
              // Convert PDF points to CSS pixels (top-left origin)
              // Use IMG rect dimensions (same source as pointer events)
              try {
                const rect = getImgRect();
                const xCss = (template.xPt / template.pageWidthPt) * rect.width;
                const wCss = (template.wPt / template.pageWidthPt) * rect.width;
                const yCss = (template.yPt / template.pageHeightPt) * rect.height;
                const hCss = (template.hPt / template.pageHeightPt) * rect.height;
                
                setCropZone({
                  x: xCss,
                  y: yCss,
                  width: wCss,
                  height: hCss,
                });
              } catch {
                // Image not loaded yet, will retry when image loads
                console.log("[Onboarding] Image rect not available yet for template conversion");
              }
            } else {
              // Fallback to percentage-based conversion (legacy)
              // Convert percentages to CSS pixels using IMG rect
              try {
                const rect = getImgRect();
                if (imageWidth > 0 && imageHeight > 0) {
                  // Scale percentages by image display size
                  const scaleX = rect.width / imageWidth;
                  const scaleY = rect.height / imageHeight;
                  setCropZone({
                    x: template.xPct * imageWidth * scaleX,
                    y: template.yPct * imageHeight * scaleY,
                    width: template.wPct * imageWidth * scaleX,
                    height: template.hPct * imageHeight * scaleY,
                  });
                }
              } catch {
                // Image not loaded yet, will retry when image loads
                console.log("[Onboarding] Image rect not available yet for template conversion");
              }
            }
            setCoordsPage(template.page);
          } else {
            // Don't set cropZone yet - wait for image to load or page to match
            setCropZone(null);
            setCoordsPage(null);
          }
        } else {
          setSavedTemplate(null);
          setCropZone(null);
          setCoordsPage(null);
        }
      } else {
        // Template not found is OK
        setSavedTemplate(null);
        setCropZone(null);
        setCoordsPage(null);
      }
    } catch (err) {
      console.error("Error loading template:", err);
      setSavedTemplate(null);
      setCropZone(null);
      setCoordsPage(null);
    } finally {
      setIsLoadingTemplate(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please upload a PDF file");
      return;
    }

      setPdfFile(file);
      setError(null);
      setSuccess(null);
      setPreviewImage(null);
      setImageWidth(0);
      setImageHeight(0);
      setCropZone(null);
      setCoordsPage(null);
      setSelectedPage(1);
      setPageCount(1); // Will be updated when we get page count from API
      setPdfDoc(null);
      setCurrentViewport(null); // Clear viewport (no longer used)

    try {
      // Render first page using MuPDF API
      // TODO: Get page count from API or first render response
      await renderPage(file, 1);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to render PDF";
      console.error("[PDF Render] Error:", err);
      setError(`Failed to render PDF: ${errorMessage}`);
      setPreviewImage(null);
      setCropZone(null);
    }
  }

  // Helper to get image rect (single source of truth)
  function getImgRect() {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) throw new Error("Image rect not available");
    return r;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!previewImage) return;
    
    // Prevent default to avoid text selection
    e.preventDefault();
    
    // Capture pointer for stable dragging
    overlayRef.current?.setPointerCapture(e.pointerId);

    // Use IMG rect (not overlay) - this is what the user visually clicks
    const rect = getImgRect();
    const xCss = e.clientX - rect.left;
    const yCss = e.clientY - rect.top;

    // Clamp to image bounds (CSS pixels)
    const clampedX = Math.max(0, Math.min(xCss, rect.width));
    const clampedY = Math.max(0, Math.min(yCss, rect.height));

    setIsSelecting(true);
    setStartPos({ x: clampedX, y: clampedY });
    setCropZone({
      x: clampedX,
      y: clampedY,
      width: 0,
      height: 0,
    });
    // Clear manual points when starting a new rectangle so calculated points show
    setManualPoints(null);
    // Clear manual points when starting a new rectangle so calculated points show
    setManualPoints(null);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSelecting || !startPos || !previewImage) return;

    // Use IMG rect (not overlay) - this is what the user visually clicks
    const rect = getImgRect();
    const xCss = e.clientX - rect.left;
    const yCss = e.clientY - rect.top;

    // Clamp to image bounds (CSS pixels)
    const clampedX = Math.max(0, Math.min(xCss, rect.width));
    const clampedY = Math.max(0, Math.min(yCss, rect.height));

    const width = clampedX - startPos.x;
    const height = clampedY - startPos.y;

    setCropZone({
      x: width < 0 ? clampedX : startPos.x,
      y: height < 0 ? clampedY : startPos.y,
      width: Math.abs(width),
      height: Math.abs(height),
    });
  }

  // Render PDF page using MuPDF API (server-side rendering)
  async function renderPage(pdfFile: File, pageNum: number) {
    try {
      setIsRenderingPdf(true);
      setError(null);

      // Render via API endpoint (uses MuPDF server-side)
      const formData = new FormData();
      formData.append("pdf", pdfFile);
      formData.append("page", String(pageNum));

      const response = await fetch("/api/pdf/render-page", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to render PDF page" }));
        throw new Error(errorData.error || "Failed to render PDF page");
      }

      const data = await response.json();

      // Set preview image from API response
      setPreviewImage(data.pngDataUrl);
      
      // Reset image loaded state when new image is set
      setImageLoaded(false);
      
      // Store rendered image dimensions (for coordinate conversion)
      setImageWidth(data.widthPx);
      setImageHeight(data.heightPx);
      
      // Store PDF page dimensions in points (from MuPDF - source of truth)
      setPageWidthPt(data.pageWidthPt);
      setPageHeightPt(data.pageHeightPt);
      
      // Store bounds for coordinate normalization (MuPDF bounds may not start at 0,0)
      setBoundsPt(data.boundsPt);
      // Only log if bounds don't start at 0,0 (to reduce console spam)
      if (data.boundsPt && (data.boundsPt.x0 !== 0 || data.boundsPt.y0 !== 0)) {
        console.log("[renderPage] Stored boundsPt (non-zero offset):", data.boundsPt);
      }
      
      // Clear viewport (no longer needed - we use proportional math)
      setCurrentViewport(null);
      
      console.log("[Onboarding] Rendered page via MuPDF API:", {
        renderedSize: {
          widthPx: data.widthPx,
          heightPx: data.heightPx,
        },
        boundsPt: data.boundsPt,
        pdfPageSize: {
          pageWidthPt: data.pageWidthPt,
          pageHeightPt: data.pageHeightPt,
        },
      });
      
      // If we have a saved template for this page, the useEffect will convert it to pixels
      // Otherwise, cropZone will remain null for user to draw
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to render PDF page";
      console.error("[PDF Render] Error:", err);
      setError(`Failed to render PDF page ${pageNum}: ${errorMessage}`);
      setPreviewImage(null);
      setPageWidthPt(0);
      setPageHeightPt(0);
    } finally {
      setIsRenderingPdf(false);
    }
  }

  async function handlePageChange(newPage: number) {
    if (!pdfFile || newPage < 1 || newPage > pageCount) return;
    
    setSelectedPage(newPage);
    await renderPage(pdfFile, newPage);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    // Release pointer capture
    if (overlayRef.current) {
      overlayRef.current.releasePointerCapture(e.pointerId);
    }

    setIsSelecting(false);
    setStartPos(null);
    // When rectangle is drawn/updated, record the current page
    if (cropZone && cropZone.width > 0 && cropZone.height > 0) {
      setCoordsPage(selectedPage);
    }
  }

  function calculatePercentages(): { xPct: number; yPct: number; wPct: number; hPct: number } | null {
    if (!cropZone || imageWidth === 0 || imageHeight === 0) return null;

    return {
      xPct: Math.round((cropZone.x / imageWidth) * 10000) / 10000,
      yPct: Math.round((cropZone.y / imageHeight) * 10000) / 10000,
      wPct: Math.round((cropZone.width / imageWidth) * 10000) / 10000,
      hPct: Math.round((cropZone.height / imageHeight) * 10000) / 10000,
    };
  }

  function handleManualCoordChange(field: "xPct" | "yPct" | "wPct" | "hPct", value: string) {
    if (!imageWidth || !imageHeight) return;
    
    // Store the raw value for display while typing
    const currentPercentages = calculatePercentages();
    const newManualCoords = manualCoords || (currentPercentages ? {
      xPct: currentPercentages.xPct.toFixed(4),
      yPct: currentPercentages.yPct.toFixed(4),
      wPct: currentPercentages.wPct.toFixed(4),
      hPct: currentPercentages.hPct.toFixed(4),
    } : null);
    
    if (!newManualCoords) return;
    
    setManualCoords({ ...newManualCoords, [field]: value });
  }

  function handleApplyManualCoords() {
    if (!manualCoords || !imageWidth || !imageHeight) return;
    
    const xPct = parseFloat(manualCoords.xPct);
    const yPct = parseFloat(manualCoords.yPct);
    const wPct = parseFloat(manualCoords.wPct);
    const hPct = parseFloat(manualCoords.hPct);

    if (isNaN(xPct) || isNaN(yPct) || isNaN(wPct) || isNaN(hPct)) {
      setError("All coordinates must be valid numbers between 0 and 1");
      return;
    }

    // Clamp values to valid ranges
    const clampedXPct = Math.max(0, Math.min(1, xPct));
    const clampedYPct = Math.max(0, Math.min(1, yPct));
    const clampedWPct = Math.max(0, Math.min(1 - clampedXPct, wPct));
    const clampedHPct = Math.max(0, Math.min(1 - clampedYPct, hPct));

    setCropZone({
      x: clampedXPct * imageWidth,
      y: clampedYPct * imageHeight,
      width: clampedWPct * imageWidth,
      height: clampedHPct * imageHeight,
    });
    setCoordsPage(selectedPage);
    setManualCoords(null);
    setError(null);
  }

  // IMPORTANT: cropZone is in CSS pixels (displayed image space).
  // Always convert CSS → natural pixels → PDF points using the SAME method as handleSave().
  // Never divide by imageWidth/imageHeight directly (those are natural px).
  // Use cssCropToNaturalPx + naturalPxToPdfPoints (same as handleSave) for consistency.
  async function calculatePoints(): Promise<{ xPt: number; yPt: number; wPt: number; hPt: number } | null> {
    const imgEl = imgRef.current;
    if (!imgEl || !cropZone || !pageWidthPt || !pageHeightPt) return null;

    // Guard: Image must be fully loaded (naturalWidth/Height are 0 until loaded)
    if (!imgEl.complete || imgEl.naturalWidth === 0 || imgEl.naturalHeight === 0) {
      console.log("[calculatePoints] Image not ready:", {
        complete: imgEl.complete,
        naturalWidth: imgEl.naturalWidth,
        naturalHeight: imgEl.naturalHeight,
      });
      return null;
    }

    try {
      // Use EXACT same conversion method as handleSave() for consistency
      const { cssCropToNaturalPx, naturalPxToPdfPoints } = await import("@/lib/templates/coordinateUtils");
      
      const rect = imgEl.getBoundingClientRect();
      
      // Step 1: Convert CSS crop → natural pixels (same as handleSave)
      const nat = cssCropToNaturalPx(imgEl, {
        x: cropZone.x,
        y: cropZone.y,
        w: cropZone.width,
        h: cropZone.height,
      });

      // Step 2: Convert natural pixels → PDF points (same as handleSave)
      // ✅ Pass boundsPt to normalize coordinates (MuPDF bounds may not start at 0,0)
      const pt = naturalPxToPdfPoints(
        nat,
        imgEl.naturalWidth,
        imgEl.naturalHeight,
        pageWidthPt,
        pageHeightPt,
        boundsPt
      );

      // Only log detailed conversion when bounds offset is non-zero or boundsPt is missing (to reduce console spam)
      if (!boundsPt || (boundsPt.x0 !== 0 || boundsPt.y0 !== 0)) {
        const xNorm = nat.x / imgEl.naturalWidth;
        const xPtBeforeBounds = xNorm * pageWidthPt;
        const xPtAfterBounds = boundsPt ? xPtBeforeBounds - boundsPt.x0 : xPtBeforeBounds;
        
        console.log("[calculatePoints] Conversion:", {
          boundsPt: boundsPt,
          boundsOffset: boundsPt ? { x0: boundsPt.x0, y0: boundsPt.y0 } : null,
          calculatedPt: pt,
          xPtFormula: boundsPt 
            ? `((${nat.x} / ${imgEl.naturalWidth}) * ${pageWidthPt}) - ${boundsPt.x0} = ${xPtAfterBounds}`
            : `(${nat.x} / ${imgEl.naturalWidth}) * ${pageWidthPt} = ${xPtBeforeBounds}`,
          warning: boundsPt ? null : "⚠️ boundsPt is null - normalization not applied!",
        });
      }
      
      return pt;
    } catch (err) {
      console.error("[calculatePoints] Error:", err);
      return null;
    }
  }

  // Update calculated points whenever cropZone changes or image loads
  // IMPORTANT: Wait for boundsPt to be available before calculating (needed for normalization)
  useEffect(() => {
    if (cropZone && cropZone.width > 0 && cropZone.height > 0 && 
        pageWidthPt && pageHeightPt && imageLoaded && boundsPt) {
      calculatePoints().then((points) => {
        setCalculatedPoints(points);
      });
    } else {
      setCalculatedPoints(null);
    }
  }, [cropZone, pageWidthPt, pageHeightPt, imageLoaded, boundsPt]);

  function handleManualPointsChange(field: "xPt" | "yPt" | "wPt" | "hPt", value: string) {
    if (!pageWidthPt || !pageHeightPt) return;
    
    const currentPoints = calculatePoints();
    const newManualPoints = manualPoints || (currentPoints ? {
      xPt: currentPoints.xPt.toFixed(2),
      yPt: currentPoints.yPt.toFixed(2),
      wPt: currentPoints.wPt.toFixed(2),
      hPt: currentPoints.hPt.toFixed(2),
    } : null);
    
    if (!newManualPoints) return;
    
    setManualPoints({ ...newManualPoints, [field]: value });
  }

  function handleApplyManualPoints() {
    if (!manualPoints || !pageWidthPt || !pageHeightPt) return;
    
    const xPt = parseFloat(manualPoints.xPt);
    const yPt = parseFloat(manualPoints.yPt);
    const wPt = parseFloat(manualPoints.wPt);
    const hPt = parseFloat(manualPoints.hPt);

    if (isNaN(xPt) || isNaN(yPt) || isNaN(wPt) || isNaN(hPt)) {
      setError("All point values must be valid numbers");
      return;
    }

    // Validate bounds
    if (xPt < 0 || yPt < 0 || wPt <= 0 || hPt <= 0 || 
        xPt + wPt > pageWidthPt || yPt + hPt > pageHeightPt) {
      setError(`Point values out of bounds. Page size: ${pageWidthPt.toFixed(2)} x ${pageHeightPt.toFixed(2)} points`);
      return;
    }

    // Convert PDF points to CSS pixels
    try {
      const rect = getImgRect();
      
      // Convert PDF points to percentages first
      const xPct = xPt / pageWidthPt;
      const yPct = yPt / pageHeightPt;
      const wPct = wPt / pageWidthPt;
      const hPct = hPt / pageHeightPt;

      // Convert percentages to CSS pixels (using image display size)
      const xCss = xPct * rect.width;
      const yCss = yPct * rect.height;
      const wCss = wPct * rect.width;
      const hCss = hPct * rect.height;

      // Clamp to image bounds
      const clampedX = Math.max(0, Math.min(xCss, rect.width));
      const clampedY = Math.max(0, Math.min(yCss, rect.height));
      const clampedW = Math.max(0, Math.min(wCss, rect.width - clampedX));
      const clampedH = Math.max(0, Math.min(hCss, rect.height - clampedY));

      setCropZone({
        x: clampedX,
        y: clampedY,
        width: clampedW,
        height: clampedH,
      });
      setCoordsPage(selectedPage);
      setManualPoints(null);
      setError(null);
    } catch (err) {
      setError("Failed to convert points to pixels. Please try again.");
      console.error("Error converting points:", err);
    }
  }

  async function handleSave() {
    // Prevent double-submit
    if (isSaving) return;
    
    if (!selectedFmKey) {
      setError("Please select an FM profile");
      return;
    }

    if (!previewImage || !cropZone) {
      setError("Please upload a PDF and select a crop zone");
      return;
    }

    // Validate that rectangle was drawn on the current page
    if (coordsPage === null || coordsPage !== selectedPage) {
      setError("Please redraw the rectangle on the current page or switch back to the page where you drew it");
      return;
    }

    // Validate we have page dimensions in points
    if (!pageWidthPt || !pageHeightPt || pageWidthPt <= 0 || pageHeightPt <= 0 || 
        !Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt)) {
      setError("PDF page dimensions not available. Please reload the PDF.");
      return;
    }

    // Validate crop zone bounds (cropZone is in CSS pixel space)
    if (cropZone.x < 0 || cropZone.y < 0 || cropZone.width <= 0 || cropZone.height <= 0) {
      setError("Invalid crop zone");
      return;
    }

    // Get IMG rect (CSS pixels) - same source as pointer events
    const rect = getImgRect();
    
    // Validate against image bounds (CSS pixels)
    if (cropZone.x + cropZone.width > rect.width || cropZone.y + cropZone.height > rect.height) {
      setError("Crop zone is out of bounds");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    // GOLDEN RULE: Use simple proportional math - NO DPI, NO SCALE, NO VIEWPORT CONVERSION
    // Convert CSS pixels to PDF points using natural image dimensions
    const { cssCropToNaturalPx, naturalPxToPdfPoints, assertPtSanity } = await import("@/lib/templates/coordinateUtils");
    
    if (!imgRef.current) {
      setError("Image element not available");
      setIsSaving(false);
      return;
    }

    if (!pageWidthPt || !pageHeightPt) {
      setError("PDF page dimensions not available");
      setIsSaving(false);
      return;
    }

    // Step 1: Convert CSS crop → natural pixels
    const nat = cssCropToNaturalPx(imgRef.current, {
      x: cropZone.x,
      y: cropZone.y,
      w: cropZone.width,
      h: cropZone.height,
    });

    // Step 2: Convert natural pixels → PDF points
    // ✅ Pass boundsPt to normalize coordinates (MuPDF bounds may not start at 0,0)
    const { xPt, yPt, wPt, hPt } = naturalPxToPdfPoints(
      nat,
      imgRef.current.naturalWidth,
      imgRef.current.naturalHeight,
      pageWidthPt,
      pageHeightPt,
      boundsPt
    );

    // Hard guard: Assert point sanity before saving
    assertPtSanity({ xPt, yPt, wPt, hPt }, pageWidthPt, pageHeightPt, selectedFmKey || "Template");

    // Debug log with all conversion details
    // GOLDEN RULE: Conversion uses simple proportional math - NO DPI, NO SCALE
    console.log("[Onboarding Save] Crop conversion details (proportional math):", {
      cropZoneCssPx: {
        x: cropZone.x,
        y: cropZone.y,
        w: cropZone.width,
        h: cropZone.height,
      },
      renderedImageSize: {
        widthPx: rect.width,
        heightPx: rect.height,
      },
      pdfPageSize: {
        pageWidthPt,
        pageHeightPt,
      },
      percentages: {
        xPct: cropZone.x / rect.width,
        yPct: cropZone.y / rect.height,
        wPct: cropZone.width / rect.width,
        hPct: cropZone.height / rect.height,
      },
      pdfPointsFinal: {
        xPt,
        yPt,
        wPt,
        hPt,
        note: "Calculated as: xPt = (cropX / imgW) * pageWidthPt",
      },
    });

    // Final payload being written to Sheets (POINTS-ONLY, no percentages)
    // Ensure all required fields are present and finite numbers
    if (!Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt)) {
      setError("PDF page dimensions are invalid. Please reload the PDF.");
      setIsSaving(false);
      return;
    }
    
    const finalPayload = {
      fmKey: selectedFmKey,
      page: coordsPage, // Use coordsPage, not selectedPage
      // PDF points in x,y,w,h order (top-left origin) - saved to named columns
      // GOLDEN RULE: These come from proportional math, NOT from DPI/scale/viewport
      xPt,
      yPt,
      wPt,
      hPt,
      pageWidthPt: Number(pageWidthPt), // Ensure it's a number
      pageHeightPt: Number(pageHeightPt), // Ensure it's a number
      coordSystem: toSheetCoordSystem(COORD_SYSTEM_PDF_POINTS_TOP_LEFT),
      // Optional: rectPx for validation/debugging (CSS pixel space)
      rectPx: {
        x: cropZone.x,
        y: cropZone.y,
        w: cropZone.width,
        h: cropZone.height,
      },
      renderWidthPx: rect.width,
      renderHeightPx: rect.height,
    };
    
    console.log("[Onboarding Save] Final payload being written to Sheets:", finalPayload);

    try {
      const response = await fetch("/api/onboarding/templates/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save template");
      }

      setSuccess("Template saved successfully!");
      // Reload the template to update savedTemplate state
      await loadExistingTemplate();
      
      // Don't auto-redirect - let user add more templates or click "Go to Dashboard" when ready
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  }

  function handleClearRectangle() {
    setCropZone(null);
    setCoordsPage(null);
    setStartPos(null);
    setIsSelecting(false);
    setManualCoords(null);
    setManualPoints(null);
  }

  const percentages = calculatePercentages();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Template Crop Zones</h1>
        <p className="text-slate-300 mb-8">
          Upload a sample work order PDF and define where the Work Order Number is located for each FM template.
          This allows the OCR system to extract work order numbers accurately.
        </p>

        <div className="space-y-6">
          {/* FM Profile Selection */}
          <div>
            <label htmlFor="fmKey" className="block text-sm font-medium mb-2">
              FM Profile <span className="text-red-400">*</span>
            </label>
            {isLoadingProfiles ? (
              <div className="text-slate-400">Loading FM profiles...</div>
            ) : fmProfiles.length === 0 ? (
              <div className="text-yellow-400">
                No FM profiles found. Please complete the FM Profiles step first.
              </div>
            ) : (
              <select
                id="fmKey"
                value={selectedFmKey}
                onChange={(e) => setSelectedFmKey(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {fmProfiles.map((profile) => (
                  <option key={profile.fmKey} value={profile.fmKey}>
                    {profile.fmLabel || profile.fmKey}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* PDF Upload */}
          <div>
            <label htmlFor="pdfFile" className="block text-sm font-medium mb-2">
              Sample PDF <span className="text-red-400">*</span>
            </label>
            <input
              id="pdfFile"
              type="file"
              accept="application/pdf"
              onChange={handleFileUpload}
              disabled={isRenderingPdf}
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="mt-2 text-sm text-slate-400">
              Upload a sample work order PDF (preferably a signed work order)
            </p>
            {isRenderingPdf && (
              <p className="mt-2 text-sm text-slate-300">Rendering PDF preview...</p>
            )}
          </div>

          {/* Preview and Crop Zone Selector */}
          {previewImage && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium">
                  Select Work Order Number Region
                </label>
                <div className="text-sm text-slate-400">
                  Cropping Page: <span className="font-semibold text-slate-200">{selectedPage}</span> of {pageCount}
                </div>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                Click and drag on the image below to select the region where the Work Order Number appears.
              </p>
              
              {/* Page Navigation */}
              {pageCount > 1 && (
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => handlePageChange(selectedPage - 1)}
                    disabled={selectedPage <= 1}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition-colors"
                  >
                    ← Previous
                  </button>
                  <span className="text-sm text-slate-300">
                    Page {selectedPage} / {pageCount}
                  </span>
                  <button
                    onClick={() => handlePageChange(selectedPage + 1)}
                    disabled={selectedPage >= pageCount}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition-colors"
                  >
                    Next →
                  </button>
                </div>
              )}

              {/* Warning banner if page changed after drawing */}
              {coordsPage !== null && coordsPage !== selectedPage && (
                <div className="mb-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg text-yellow-200">
                  <p className="font-medium mb-1">Page Mismatch</p>
                  <p className="text-sm">
                    You changed pages. The current rectangle was drawn on page {coordsPage}. Switch back to page {coordsPage} or redraw on this page.
                  </p>
                </div>
              )}
              <div
                ref={imageContainerRef}
                className="relative border-2 border-slate-700 rounded-lg overflow-hidden bg-slate-800"
                style={{ maxWidth: "100%" }}
              >
                <img
                  ref={imgRef}
                  src={previewImage}
                  alt="PDF Preview"
                  style={{ display: "block", width: "100%", height: "auto" }}
                  draggable={false}
                  onLoad={() => {
                    // Mark image as loaded and verify dimensions
                    const img = imgRef.current;
                    if (img && imageWidth > 0 && imageHeight > 0) {
                      // Verify natural dimensions match API response
                      if (Math.abs(img.naturalWidth - imageWidth) > 1 || Math.abs(img.naturalHeight - imageHeight) > 1) {
                        console.warn("[Image Load] Dimension mismatch:", {
                          natural: { w: img.naturalWidth, h: img.naturalHeight },
                          api: { w: imageWidth, h: imageHeight },
                        });
                      }
                    }
                    setImageLoaded(true);
                  }}
                />
                {/* Single overlay element for pointer events - positioned exactly over preview */}
                <div
                  ref={overlayRef}
                  className="absolute inset-0 cursor-crosshair"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: "100%",
                    height: "100%",
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  {/* Crop zone rectangle overlay - positioned using percentages to match overlay coordinate space */}
                  {cropZone && cropZone.width > 0 && cropZone.height > 0 && (
                    <div
                      className="absolute border-2 border-sky-500 bg-sky-500/20 pointer-events-none"
                      style={{
                        // Draw rectangle in CSS pixels (cropZone is stored in CSS pixels)
                        left: `${cropZone.x}px`,
                        top: `${cropZone.y}px`,
                        width: `${cropZone.width}px`,
                        height: `${cropZone.height}px`,
                      }}
                    />
                  )}
                </div>
              </div>

              {/* PDF Points Display / Edit (Primary) */}
              {cropZone && pageWidthPt > 0 && pageHeightPt > 0 && (
                <div className="mt-4 p-4 bg-slate-800 rounded-lg">
                  <div className="text-sm font-medium mb-3">Crop Zone PDF Points (editable):</div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">xPt:</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={pageWidthPt}
                        value={manualPoints?.xPt ?? (calculatedPoints?.xPt.toFixed(2) ?? "0.00")}
                        onChange={(e) => handleManualPointsChange("xPt", e.target.value)}
                        onBlur={() => {
                          if (manualPoints) {
                            handleApplyManualPoints();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">yPt:</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={pageHeightPt}
                        value={manualPoints?.yPt ?? (calculatedPoints?.yPt.toFixed(2) ?? "0.00")}
                        onChange={(e) => handleManualPointsChange("yPt", e.target.value)}
                        onBlur={() => {
                          if (manualPoints) {
                            handleApplyManualPoints();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">wPt:</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={pageWidthPt}
                        value={manualPoints?.wPt ?? (calculatedPoints?.wPt.toFixed(2) ?? "0.00")}
                        onChange={(e) => handleManualPointsChange("wPt", e.target.value)}
                        onBlur={() => {
                          if (manualPoints) {
                            handleApplyManualPoints();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">hPt:</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={pageHeightPt}
                        value={manualPoints?.hPt ?? (calculatedPoints?.hPt.toFixed(2) ?? "0.00")}
                        onChange={(e) => handleManualPointsChange("hPt", e.target.value)}
                        onBlur={() => {
                          if (manualPoints) {
                            handleApplyManualPoints();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Edit PDF point values above to adjust the crop zone. Page size: {pageWidthPt.toFixed(2)} x {pageHeightPt.toFixed(2)} points. Changes apply when you click outside the field.
                  </p>
                  
                  {/* Debug Panel - Live computed point values */}
                  {calculatedPoints && (
                    <div className="mt-4 p-3 bg-slate-900/50 border border-slate-600 rounded text-xs font-mono">
                      <div className="text-slate-400 mb-2">Live Computed Points (Debug):</div>
                      <div className="grid grid-cols-4 gap-2 text-slate-300">
                        <div>
                          <span className="text-slate-500">xPt:</span>{" "}
                          <span className={calculatedPoints.xPt >= 440 && calculatedPoints.xPt <= 465 ? "text-green-400" : "text-yellow-400"}>
                            {calculatedPoints.xPt.toFixed(2)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">yPt:</span> {calculatedPoints.yPt.toFixed(2)}
                        </div>
                        <div>
                          <span className="text-slate-500">wPt:</span> {calculatedPoints.wPt.toFixed(2)}
                        </div>
                        <div>
                          <span className="text-slate-500">hPt:</span> {calculatedPoints.hPt.toFixed(2)}
                        </div>
                      </div>
                      {calculatedPoints.xPt >= 440 && calculatedPoints.xPt <= 465 && (
                        <div className="mt-2 text-green-400 text-xs">✓ xPt is in expected range (440-465)</div>
                      )}
                      {(calculatedPoints.xPt < 440 || calculatedPoints.xPt > 465) && (
                        <div className="mt-2 text-yellow-400 text-xs">⚠ xPt should be around 440-465 for superclean</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Percentages Display / Edit (Legacy - REMOVED: PDF_POINTS_TOP_LEFT is the only source of truth) */}
              {false && false && percentages && (
                <div className="mt-4 p-4 bg-slate-800 rounded-lg">
                  <div className="text-sm font-medium mb-3">Crop Zone Percentages (0.0 to 1.0) - Legacy:</div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">xPct:</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="1"
                        value={manualCoords?.xPct ?? percentages.xPct.toFixed(4)}
                        onChange={(e) => handleManualCoordChange("xPct", e.target.value)}
                        onBlur={() => {
                          if (manualCoords) {
                            handleApplyManualCoords();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">yPct:</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="1"
                        value={manualCoords?.yPct ?? percentages.yPct.toFixed(4)}
                        onChange={(e) => handleManualCoordChange("yPct", e.target.value)}
                        onBlur={() => {
                          if (manualCoords) {
                            handleApplyManualCoords();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">wPct:</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="1"
                        value={manualCoords?.wPct ?? percentages.wPct.toFixed(4)}
                        onChange={(e) => handleManualCoordChange("wPct", e.target.value)}
                        onBlur={() => {
                          if (manualCoords) {
                            handleApplyManualCoords();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-xs">hPct:</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="1"
                        value={manualCoords?.hPct ?? percentages.hPct.toFixed(4)}
                        onChange={(e) => handleManualCoordChange("hPct", e.target.value)}
                        onBlur={() => {
                          if (manualCoords) {
                            handleApplyManualCoords();
                          }
                        }}
                        className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Edit values above to adjust the crop zone. Changes apply when you click outside the field or save.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {error && (
            <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-200">
              {error}
            </div>
          )}

          {success && (
            <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg text-green-200">
              {success}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4">
            <button
              onClick={handleSave}
              disabled={
                isSaving || 
                !selectedFmKey || 
                !previewImage || 
                !cropZone || 
                coordsPage === null ||
                coordsPage !== selectedPage
              }
              className="px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {isSaving ? "Saving..." : "Save Template Zone"}
            </button>
            {cropZone && (
              <button
                onClick={handleClearRectangle}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
              >
                Clear Rectangle
              </button>
            )}
            {savedTemplate && (
              <button
                onClick={async () => {
                  // Mark onboarding complete when user explicitly clicks to finish
                  try {
                    await fetch("/api/onboarding/complete", { method: "POST" });
                  } catch (e) {
                    console.error("Failed to mark onboarding complete:", e);
                  }
                  router.push("/pro");
                }}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
              >
                Go to Dashboard →
              </button>
            )}
          </div>
          {!savedTemplate && (
            <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg text-yellow-200">
              <p className="font-medium mb-1">Required Step</p>
              <p className="text-sm">
                Before automation can run, you must set the Work Order Number crop zone for at least one FM template.
                Please upload a PDF and select the crop zone above.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

