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
        // DO compute scale from rendered PNG dimensions (imageWidth/imageHeight), NOT container size
        // This ensures the overlay aligns correctly with the rendered image
        const scaleX = imageWidth / savedTemplate.pageWidthPt;
        const scaleY = imageHeight / savedTemplate.pageHeightPt;
        const xCss = savedTemplate.xPt * scaleX;
        const yCss = savedTemplate.yPt * scaleY;
        const wCss = savedTemplate.wPt * scaleX;
        const hCss = savedTemplate.hPt * scaleY;
        
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
          if (pdfDoc && template.page && template.page !== selectedPage) {
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
      setIsRenderingPdf(true);
      setPreviewImage(null);
      setImageWidth(0);
      setImageHeight(0);
      setCropZone(null);
      setCoordsPage(null);
      setSelectedPage(1);
      setPageCount(0);
      setPdfDoc(null);
      setCurrentViewport(null); // Clear viewport when loading new PDF

    try {
      // Ensure pdf.js is loaded (uses shared helper)
      const pdfjsLib = await initPdfJsLib();

      if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
        throw new Error("PDF.js library not loaded correctly");
      }

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Validate PDF header
      const header = String.fromCharCode(...uint8Array.slice(0, 5));
      if (header !== "%PDF-") {
        throw new Error("Invalid PDF file format");
      }

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
      const pdf = await loadingTask.promise;

      // Store PDF document for page navigation
      setPdfDoc(pdf);
      
      // Get page count
      const numPages = pdf.numPages;
      setPageCount(numPages);
      
      // Reset to page 1 when new PDF is loaded
      setSelectedPage(1);
      setCoordsPage(null);
      
      // Render first page
      await renderPage(pdf, 1);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to render PDF";
      console.error("[PDF Render] Error:", err);
      setError(`Failed to render PDF: ${errorMessage}`);
      setPreviewImage(null);
      setCropZone(null);
    } finally {
      setIsRenderingPdf(false);
    }
  }

  // Helper to get image rect (single source of truth)
  function getImgRect() {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) throw new Error("Image rect not available");
    return r;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!previewImage || !currentViewport) return;
    
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function renderPage(pdf: any, pageNum: number) {
    try {
      const page = await pdf.getPage(pageNum);
      
      // Get PDF page size in true PDF points (user space units)
      // Note: getViewport({ scale: 1.0 }) gives CSS pixels (96 DPI), not PDF points (72 DPI)
      // Use page.view to get actual PDF user-space coordinates in points
      const [xMin, yMin, xMax, yMax] = page.view; // PDF units (points)
      const truePageWidthPt = xMax - xMin;
      const truePageHeightPt = yMax - yMin;
      setPageWidthPt(truePageWidthPt);
      setPageHeightPt(truePageHeightPt);
      
      // Store view box offset for coordinate conversion
      // The viewport.convertToPdfPoint accounts for this, but we need to verify
      console.log("[Onboarding] PDF page view box:", { xMin, yMin, xMax, yMax, width: truePageWidthPt, height: truePageHeightPt });
      
      // Optional sanity log to verify the fix
      const v1 = page.getViewport({ scale: 1.0 });
      console.log("[Onboarding] page.view (pt):", page.view, "wPt:", truePageWidthPt, "hPt:", truePageHeightPt);
      console.log("[Onboarding] viewport scale=1 (css px):", v1.width, v1.height);
      
      // Use scale 2.0 for preview rendering (better quality)
      // Include page rotation if present
      const viewport = page.getViewport({ 
        scale: 2.0, 
        rotation: page.rotate || 0 
      });

      // Store viewport for accurate pixel->PDF point conversion
      setCurrentViewport(viewport);

      // Create canvas to render the page
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Failed to get canvas context");
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Render PDF page to canvas
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      await page.render(renderContext).promise;

      // Convert canvas to data URL (PNG)
      const dataUrl = canvas.toDataURL("image/png");
      
      setPreviewImage(dataUrl);
      // Use canvas dimensions (matches viewport.width/height) - ensures rectPx coordinates match render dimensions
      setImageWidth(canvas.width);
      setImageHeight(canvas.height);
      
      console.log("[Onboarding] Rendered page with viewport:", {
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        pageWidthPt: truePageWidthPt,
        pageHeightPt: truePageHeightPt,
        rotation: page.rotate || 0,
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
    }
  }

  async function handlePageChange(newPage: number) {
    if (!pdfDoc || newPage < 1 || newPage > pageCount) return;
    
    setSelectedPage(newPage);
    await renderPage(pdfDoc, newPage);
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

  function calculatePoints(): { xPt: number; yPt: number; wPt: number; hPt: number } | null {
    if (!cropZone || !currentViewport || !pageWidthPt || !pageHeightPt || !imageWidth || !imageHeight) return null;

    // Convert cropZone (CSS px) to viewport px, then to PDF points
    try {
      const rect = getImgRect();
      // Scale from CSS-displayed size to viewport pixel size
      const scaleX = currentViewport.width / rect.width;
      const scaleY = currentViewport.height / rect.height;

      const x0 = cropZone.x * scaleX;
      const y0 = cropZone.y * scaleY;
      const x1 = (cropZone.x + cropZone.width) * scaleX;
      const y1 = (cropZone.y + cropZone.height) * scaleY;

      // Use viewport.convertToPdfPoint - it returns PDF coordinates (bottom-left origin)
      const [x0Pt, y0PtBottom] = currentViewport.convertToPdfPoint(x0, y0);
      const [x1Pt, y1PtBottom] = currentViewport.convertToPdfPoint(x1, y1);

      // Normalize with min/max to guarantee XYWH is correct
      const xMin = Math.min(x0Pt, x1Pt);
      const xMax = Math.max(x0Pt, x1Pt);
      const yMinBottom = Math.min(y0PtBottom, y1PtBottom);
      const yMaxBottom = Math.max(y0PtBottom, y1PtBottom);

      // Convert Y to TOP-LEFT points: yPtTopLeft = pageHeightPt - yMaxBottom
      const xPt = xMin;
      const wPt = xMax - xMin;
      const hPt = yMaxBottom - yMinBottom;
      const yPtTopLeft = pageHeightPt - yMaxBottom;

      return { xPt, yPt: yPtTopLeft, wPt, hPt };
    } catch {
      return null;
    }
  }

  // Update calculated points whenever cropZone changes
  useEffect(() => {
    if (cropZone && cropZone.width > 0 && cropZone.height > 0 && currentViewport && pageWidthPt && pageHeightPt && imageWidth && imageHeight) {
      const points = calculatePoints();
      setCalculatedPoints(points);
    } else {
      setCalculatedPoints(null);
    }
  }, [cropZone, currentViewport, pageWidthPt, pageHeightPt, imageWidth, imageHeight]);

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

    if (!currentViewport) {
      setError("Viewport not available. Please reload the PDF.");
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

    // Convert cropZone (CSS px) into viewport/render px
    // CRITICAL: viewport.convertToPdfPoint expects coordinates in viewport pixel space
    // The viewport is at scale 2.0, so viewport.width = imageWidth (canvas dimensions)
    // We need to scale from CSS-displayed size to viewport pixel size
    const scaleX = currentViewport.width / rect.width;
    const scaleY = currentViewport.height / rect.height;

    const x0 = cropZone.x * scaleX;
    const y0 = cropZone.y * scaleY;
    const x1 = (cropZone.x + cropZone.width) * scaleX;
    const y1 = (cropZone.y + cropZone.height) * scaleY;

    // Use the same pdf.js viewport used for rendering the preview (same scale/rotation)
    // Convert BOTH corners using viewport.convertToPdfPoint()
    // Note: viewport.convertToPdfPoint returns coordinates in PDF coordinate space (bottom-left origin)
    // It expects coordinates in viewport pixel space (which is at scale 2.0)
    const [x0Pt, y0PtBottom] = currentViewport.convertToPdfPoint(x0, y0);
    const [x1Pt, y1PtBottom] = currentViewport.convertToPdfPoint(x1, y1);

    // Normalize with min/max to guarantee XYWH is correct
    const xMin = Math.min(x0Pt, x1Pt);
    const xMax = Math.max(x0Pt, x1Pt);
    const yMinBottom = Math.min(y0PtBottom, y1PtBottom); // Bottom edge in PDF coordinates
    const yMaxBottom = Math.max(y0PtBottom, y1PtBottom); // Top edge in PDF coordinates

    // Convert Y to TOP-LEFT points: yPtTopLeft = pageHeightPt - yMaxBottom
    const xPt = xMin;
    const wPt = xMax - xMin;
    const hPt = yMaxBottom - yMinBottom;
    const yPtTopLeft = pageHeightPt - yMaxBottom;

    // Debug log with all conversion details (as requested)
    // "Truth log" to verify mismatch is gone - these 3 should line up
    console.log("[Onboarding Save] Crop conversion details:", {
      imgRect: {
        width: rect.width,
        height: rect.height,
      },
      viewport: {
        width: currentViewport.width,
        height: currentViewport.height,
        rotation: currentViewport.rotation || 0,
      },
      scale: {
        scaleX,
        scaleY,
      },
      cropZone: {
        x: cropZone.x,
        y: cropZone.y,
        w: cropZone.width,
        h: cropZone.height,
      },
      rectViewportPx: {
        x0,
        y0,
        x1,
        y1,
      },
      pdfPointsRaw: {
        x0Pt,
        y0PtBottom,
        x1Pt,
        y1PtBottom,
      },
      pdfPointsFinal: {
        xPt,
        yPtTopLeft,
        wPt,
        hPt,
      },
      pageSize: {
        pageWidthPt,
        pageHeightPt,
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
      xPt,
      yPt: yPtTopLeft,
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
      renderWidthPx: currentViewport.width,
      renderHeightPx: currentViewport.height,
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

