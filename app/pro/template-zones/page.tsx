"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";

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

function TemplateZonesPageContent() {
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
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [pageCount, setPageCount] = useState<number>(0);
  const [coordsPage, setCoordsPage] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const hasInitializedFromQuery = useRef<boolean>(false);
  const [manualCoords, setManualCoords] = useState<{ xPct: string; yPct: string; wPct: string; hPct: string } | null>(null);
  const [manualPoints, setManualPoints] = useState<{ xPt: string; yPt: string; wPt: string; hPt: string } | null>(null);
  const [calculatedPoints, setCalculatedPoints] = useState<{ xPt: number; yPt: number; wPt: number; hPt: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [currentViewport, setCurrentViewport] = useState<any>(null);
  const [showAddFmForm, setShowAddFmForm] = useState(false);
  const [newFmKey, setNewFmKey] = useState("");
  const [newFmLabel, setNewFmLabel] = useState("");
  const [newFmDomain, setNewFmDomain] = useState("");
  const [isCreatingFm, setIsCreatingFm] = useState(false);
  
  // Known working coordinates per fmKey (can be expanded)
  // These are tested coordinates that work well for each FM profile
  const calibratedCoordinates: Record<string, { xPct: number; yPct: number; wPct: number; hPct: number }> = {
    superclean: {
      xPct: 0.70,  // Slightly left to include more context
      yPct: 0.00,  // Top of page
      wPct: 0.28,  // Slightly wider to include surrounding text
      hPct: 0.12,  // Increased from 0.05 to 0.12 to include context around WO number
    },
    "23rdgroup": {
      xPct: 0.02,
      yPct: 0.14,
      wPct: 0.30,
      hPct: 0.032,
    },
  };

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
        // To convert back to CSS pixels, we need to do the EXACT REVERSE of calculatePoints():
        // 1. Add bounds offset to get bounds-space coordinates (reverse of normalization)
        // 2. Convert bounds-space PDF points → canvas pixels (using SAVED page dimensions)
        // 3. Convert canvas pixels → CSS pixels (account for CSS scaling)
        
        // CRITICAL: Use SAVED page dimensions (savedTemplate.pageWidthPt/pageHeightPt) for conversion
        // The coordinates were saved relative to these dimensions, so we must use them to convert back
        // If the current page has different dimensions, the coordinates will be proportionally scaled
        const xPtBoundsSpace = boundsPt ? savedTemplate.xPt + boundsPt.x0 : savedTemplate.xPt;
        const yPtBoundsSpace = boundsPt ? savedTemplate.yPt + boundsPt.y0 : savedTemplate.yPt;
        
        // Debug: Log conversion details to diagnose coordinate drift
        if (boundsPt && (boundsPt.x0 !== 0 || boundsPt.y0 !== 0)) {
          console.log("[Template Zones Load] Converting saved template:", {
            saved: { xPt: savedTemplate.xPt, yPt: savedTemplate.yPt, wPt: savedTemplate.wPt, hPt: savedTemplate.hPt },
            savedPageSize: { w: savedTemplate.pageWidthPt, h: savedTemplate.pageHeightPt },
            currentPageSize: { w: pageWidthPt, h: pageHeightPt },
            currentBounds: boundsPt,
            xPtBoundsSpace,
            yPtBoundsSpace,
          });
        }
        
        // Step 1: PDF points → canvas pixels (using SAVED page dimensions)
        // Use the same proportional math as calculatePoints() but in reverse
        // If current page size differs from saved, coordinates will scale proportionally
        const xNorm = xPtBoundsSpace / savedTemplate.pageWidthPt;
        const yNorm = yPtBoundsSpace / savedTemplate.pageHeightPt;
        const wNorm = savedTemplate.wPt / savedTemplate.pageWidthPt;
        const hNorm = savedTemplate.hPt / savedTemplate.pageHeightPt;
        
        const xCanvas = xNorm * imageWidth;
        const yCanvas = yNorm * imageHeight;
        const wCanvas = wNorm * imageWidth;
        const hCanvas = hNorm * imageHeight;
        
        // Step 2: Canvas pixels → CSS pixels (reverse of calculatePoints conversion)
        // Get displayed rect to calculate scale factor
        const rect = imageContainerRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const scaleX = rect.width / imageWidth;
          const scaleY = rect.height / imageHeight;
          
          const xCss = xCanvas * scaleX;
          const yCss = yCanvas * scaleY;
          const wCss = wCanvas * scaleX;
          const hCss = hCanvas * scaleY;
          
          // Debug: Log final conversion
          if (boundsPt && (boundsPt.x0 !== 0 || boundsPt.y0 !== 0)) {
            console.log("[Template Zones Load] Final CSS coords:", {
              canvas: { x: xCanvas, y: yCanvas, w: wCanvas, h: hCanvas },
              displayedRect: { w: rect.width, h: rect.height },
              scale: { x: scaleX, y: scaleY },
              css: { x: xCss, y: yCss, w: wCss, h: hCss },
            });
          }
          
          setCropZone({
            x: xCss,
            y: yCss,
            width: wCss,
            height: hCss,
          });
        } else {
          // Fallback if rect not available yet - try again after a short delay
          // This can happen if the image hasn't fully rendered yet
          const timeoutId = setTimeout(() => {
            const retryRect = imageContainerRef.current?.getBoundingClientRect();
            if (retryRect && retryRect.width > 0 && retryRect.height > 0) {
              const scaleX = retryRect.width / imageWidth;
              const scaleY = retryRect.height / imageHeight;
              
              setCropZone({
                x: xCanvas * scaleX,
                y: yCanvas * scaleY,
                width: wCanvas * scaleX,
                height: hCanvas * scaleY,
              });
            } else {
              // Final fallback - use canvas pixels directly (may be slightly off)
              setCropZone({
                x: xCanvas,
                y: yCanvas,
                width: wCanvas,
                height: hCanvas,
              });
            }
          }, 100);
          
          return () => clearTimeout(timeoutId);
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
  }, [previewImage, imageWidth, imageHeight, savedTemplate, selectedPage, pageWidthPt, pageHeightPt, boundsPt]);

  // Update calculated points whenever cropZone changes
  // This captures the coords when displayed correctly, so we can save them as-is
  useEffect(() => {
    if (cropZone && cropZone.width > 0 && cropZone.height > 0 && 
        pageWidthPt && pageHeightPt && imageWidth && imageHeight && imageContainerRef.current) {
      const points = calculatePoints();
      setCalculatedPoints(points);
    } else {
      setCalculatedPoints(null);
    }
  }, [cropZone, pageWidthPt, pageHeightPt, imageWidth, imageHeight, boundsPt]);

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
        const errorData = await response.json().catch(() => ({ error: "Failed to load facility senders" }));
        setError(errorData.error || "Failed to load facility senders");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load facility senders");
    } finally {
      setIsLoadingProfiles(false);
    }
  }

  async function handleCreateFmProfile() {
    if (!newFmKey.trim()) {
      setError("FM Key is required");
      return;
    }

    const normalizedKey = normalizeFmKey(newFmKey);
    if (!normalizedKey) {
      setError("FM Key must contain at least one letter or number");
      return;
    }

    // Check if FM key already exists
    if (fmProfiles.some(p => p.fmKey === normalizedKey)) {
      setError(`Facility sender "${normalizedKey}" already exists`);
      return;
    }

    setIsCreatingFm(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/fm-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            fmKey: normalizedKey,
            fmLabel: newFmLabel.trim() || normalizedKey,
            page: 1,
            xPct: 0,
            yPct: 0,
            wPct: 1,
            hPct: 1,
            senderDomains: newFmDomain.trim() || undefined,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create facility sender");
      }

      setSuccess(`Facility sender "${normalizedKey}" created successfully!`);
      setNewFmKey("");
      setNewFmLabel("");
      setNewFmDomain("");
      setShowAddFmForm(false);
      
      // Reload profiles and auto-select the new one
      await loadFmProfiles();
      setSelectedFmKey(normalizedKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create facility sender");
    } finally {
      setIsCreatingFm(false);
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
          
          // Convert template to pixel coordinates if we have an image
          // Prefer PDF points if available, otherwise fallback to percentages
          if (previewImage && imageWidth > 0 && imageHeight > 0 && template.page === selectedPage) {
            // If template has PDF points and we have page dimensions, use points → pixels conversion
            const normalizedCoordSystem = normalizeCoordSystem(template.coordSystem);
            if (normalizedCoordSystem === COORD_SYSTEM_PDF_POINTS_TOP_LEFT && 
                template.pageWidthPt && template.pageHeightPt &&
                template.xPt !== undefined && template.yPt !== undefined &&
                template.wPt !== undefined && template.hPt !== undefined &&
                pageWidthPt > 0 && pageHeightPt > 0) {
              // Convert PDF points to pixels (top-left origin)
              // DO compute scale from rendered PNG dimensions (imageWidth/imageHeight), NOT container size
              // This ensures the overlay aligns correctly with the rendered image
              const scaleX = imageWidth / template.pageWidthPt;
              const scaleY = imageHeight / template.pageHeightPt;
              const xPx = template.xPt * scaleX;
              const yPx = template.yPt * scaleY;
              const wPx = template.wPt * scaleX;
              const hPx = template.hPt * scaleY;
              
              setCropZone({
                x: xPx,
                y: yPx,
                width: wPx,
                height: hPx,
              });
            } else {
              // Fallback to percentage-based conversion (legacy)
              setCropZone({
                x: template.xPct * imageWidth,
                y: template.yPct * imageHeight,
                width: template.wPct * imageWidth,
                height: template.hPct * imageHeight,
              });
            }
            setCoordsPage(template.page);
          } else {
            // Don't set cropZone yet - wait for image to load or page to match
            setCropZone(null);
            setCoordsPage(null);
          }
        } else {
          // No template found - if we have calibrated coordinates, offer to use them
          setSavedTemplate(null);
          // Don't set cropZone here - wait for PDF/image to load, then auto-apply in renderPage
        }
      } else {
        // Template not found is OK - calibrated coords will be auto-applied when PDF loads
        setSavedTemplate(null);
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
      
      // After PDF loads, check if we should auto-apply calibrated coordinates
      // This happens after renderPage sets imageWidth/imageHeight
      setTimeout(() => {
        if (selectedFmKey && calibratedCoordinates[selectedFmKey] && !savedTemplate) {
          // Only auto-apply if no saved template exists
          const calibrated = calibratedCoordinates[selectedFmKey];
          if (imageWidth > 0 && imageHeight > 0) {
            setCropZone({
              x: calibrated.xPct * imageWidth,
              y: calibrated.yPct * imageHeight,
              width: calibrated.wPct * imageWidth,
              height: calibrated.hPct * imageHeight,
            });
            setCoordsPage(selectedPage);
            setSuccess(`Auto-applied calibrated coordinates for ${selectedFmKey}. Review and adjust if needed.`);
          }
        }
      }, 100); // Small delay to ensure image dimensions are set
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to render PDF";
      console.error("[PDF Render] Error:", err);
      setError(`Failed to render PDF: ${errorMessage}`);
      setPreviewImage(null);
      setCropZone(null);
      setPageWidthPt(0);
      setPageHeightPt(0);
    } finally {
      setIsRenderingPdf(false);
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewImage || !imageContainerRef.current) return;

    const rect = imageContainerRef.current.getBoundingClientRect();
    // Get coordinates in CSS pixels (displayed size)
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clamp to displayed image bounds (CSS pixels)
    const clampedX = Math.max(0, Math.min(x, rect.width));
    const clampedY = Math.max(0, Math.min(y, rect.height));

    setIsSelecting(true);
    setStartPos({ x: clampedX, y: clampedY });
    setCropZone({
      x: clampedX,
      y: clampedY,
      width: 0,
      height: 0,
    });
    // Clear calculated points when starting a new rectangle
    setCalculatedPoints(null);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isSelecting || !startPos || !previewImage || !imageContainerRef.current) return;

    const rect = imageContainerRef.current.getBoundingClientRect();
    // Get coordinates in CSS pixels (displayed size)
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clamp to displayed image bounds (CSS pixels)
    const clampedX = Math.max(0, Math.min(x, rect.width));
    const clampedY = Math.max(0, Math.min(y, rect.height));

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
      // IMPORTANT: page.view may not start at (0,0) - store bounds for normalization
      const [xMin, yMin, xMax, yMax] = page.view; // PDF units (points)
      const truePageWidthPt = xMax - xMin;
      const truePageHeightPt = yMax - yMin;
      setPageWidthPt(truePageWidthPt);
      setPageHeightPt(truePageHeightPt);
      
      // Store bounds for coordinate normalization (pdf.js bounds may not start at 0,0)
      setBoundsPt({ x0: xMin, y0: yMin, x1: xMax, y1: yMax });
      // Only log if bounds don't start at 0,0 (to reduce console spam)
      if (xMin !== 0 || yMin !== 0) {
        console.log("[Template Zones] Stored boundsPt (non-zero offset):", { x0: xMin, y0: yMin, x1: xMax, y1: yMax });
      }
      
      // Optional sanity log to verify the fix
      const v1 = page.getViewport({ scale: 1.0 });
      console.log("[Template Zones] page.view (pt):", page.view, "wPt:", truePageWidthPt, "hPt:", truePageHeightPt);
      console.log("[Template Zones] viewport scale=1 (css px):", v1.width, v1.height);
      
      // Use scale 2.0 for preview rendering (better quality)
      const viewport = page.getViewport({ scale: 2.0 });

      // Create canvas to render the page
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Failed to get canvas context");
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Store viewport for accurate pixel->PDF point conversion
      setCurrentViewport(viewport);

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
      
      // If we have a saved template for this page, the useEffect will convert it to pixels
      // Otherwise, auto-apply calibrated coordinates if available (for new users)
      if (!savedTemplate && selectedFmKey && calibratedCoordinates[selectedFmKey]) {
        const calibrated = calibratedCoordinates[selectedFmKey];
        setCropZone({
          x: calibrated.xPct * viewport.width,
          y: calibrated.yPct * viewport.height,
          width: calibrated.wPct * viewport.width,
          height: calibrated.hPct * viewport.height,
        });
        setCoordsPage(pageNum);
        setSuccess(`Auto-applied calibrated coordinates for ${selectedFmKey}. Review and adjust if needed, then save.`);
      }
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

  function handleMouseUp() {
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
    if (!cropZone || !pageWidthPt || !pageHeightPt || !imageWidth || !imageHeight || !imageContainerRef.current) return null;

    // IMPORTANT: Use proportional conversion (same as onboarding page) instead of convertToPdfPoint()
    // This ensures consistency and avoids issues with viewport conversion
    // cropZone is in CSS pixels (from getBoundingClientRect)
    // Convert CSS pixels → canvas pixels → PDF points using proportional math
    try {
      const rect = imageContainerRef.current.getBoundingClientRect();
      
      // Step 1: Convert CSS pixels → canvas pixels (account for CSS scaling)
      const scaleX = imageWidth / rect.width;
      const scaleY = imageHeight / rect.height;
      
      const xCanvas = cropZone.x * scaleX;
      const yCanvas = cropZone.y * scaleY;
      const wCanvas = cropZone.width * scaleX;
      const hCanvas = cropZone.height * scaleY;

      // Step 2: Convert canvas pixels → PDF points using proportional math
      // Use the same approach as onboarding page: (canvasPx / canvasSize) * pageSizePt
      // cropZone coordinates are from top-left (CSS pixels), and we want top-left PDF points
      const xNorm = xCanvas / imageWidth;
      const yNorm = yCanvas / imageHeight;
      const wNorm = wCanvas / imageWidth;
      const hNorm = hCanvas / imageHeight;

      // Calculate in bounds space first (proportional to page size)
      const xPtBoundsSpace = xNorm * pageWidthPt;
      const yPtBoundsSpace = yNorm * pageHeightPt;
      const wPt = wNorm * pageWidthPt;
      const hPt = hNorm * pageHeightPt;

      // ✅ Normalize bounds -> 0-based page space (same as MuPDF fix)
      const xPt = boundsPt ? xPtBoundsSpace - boundsPt.x0 : xPtBoundsSpace;
      const yPt = boundsPt ? yPtBoundsSpace - boundsPt.y0 : yPtBoundsSpace;

      // Log conversion details to diagnose coordinate drift
      console.log("[Template Zones calculatePoints] Conversion:", {
        cropZoneCss: { x: cropZone.x, y: cropZone.y, w: cropZone.width, h: cropZone.height },
        displayedRect: { w: rect.width, h: rect.height },
        canvasSize: { w: imageWidth, h: imageHeight },
        scale: { x: scaleX, y: scaleY },
        canvasCoords: { x: xCanvas, y: yCanvas, w: wCanvas, h: hCanvas },
        norms: { xNorm, yNorm, wNorm, hNorm },
        xPtBoundsSpace: xPtBoundsSpace,
        boundsPt: boundsPt,
        xPtAfterBounds: xPt,
        yPt: yPt,
        wPt: wPt,
        hPt: hPt,
        xPtFormula: boundsPt 
          ? `(${xNorm} * ${pageWidthPt}) - ${boundsPt.x0} = ${xPt}`
          : `${xNorm} * ${pageWidthPt} = ${xPt}`,
      });

      return { xPt, yPt, wPt, hPt };
    } catch (err) {
      console.error("[Template Zones calculatePoints] Error:", err);
      return null;
    }
  }

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
    if (!manualPoints || !pageWidthPt || !pageHeightPt || !imageWidth || !imageHeight) return;
    
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

    // Convert PDF points to percentages, then to pixels
    const xPct = xPt / pageWidthPt;
    const yPct = yPt / pageHeightPt;
    const wPct = wPt / pageWidthPt;
    const hPct = hPt / pageHeightPt;

    // Clamp values
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
    setManualPoints(null);
    setError(null);
  }

  async function handleSave() {
    // Prevent double-submit
    if (isSaving) return;
    
    if (!selectedFmKey) {
      setError("Please select a facility sender");
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
    
    // Use stored calculatedPoints instead of recalculating
    // This ensures we save the exact coords that were displayed to the user
    // Recalculating at save time can cause drift if getBoundingClientRect() returns different values
    if (!calculatedPoints) {
      setError("Failed to calculate PDF points. Please redraw the rectangle.");
      return;
    }
    
    const points = calculatedPoints; // Use stored points, not recalculated
    
    // Debug log to verify we're using stored points
    console.log("[Template Zones Save] Using stored calculated points (not recalculated):", {
      xPt: points.xPt,
      yPt: points.yPt,
      wPt: points.wPt,
      hPt: points.hPt,
      cropZone: cropZone,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      pageWidthPt: pageWidthPt,
      pageHeightPt: pageHeightPt,
      boundsPt: boundsPt,
    });

    // Validate crop zone bounds
    if (cropZone.x < 0 || cropZone.y < 0 || cropZone.width <= 0 || cropZone.height <= 0) {
      setError("Invalid crop zone");
      return;
    }

    if (cropZone.x + cropZone.width > imageWidth || cropZone.y + cropZone.height > imageHeight) {
      setError("Crop zone is out of bounds");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    // Debug log to verify rectPx matches render dimensions
    console.log("[Template Zones Save] Debug coordinates:", {
      rectPx: {
        x: cropZone.x,
        y: cropZone.y,
        w: cropZone.width,
        h: cropZone.height,
      },
      renderWidthPx: imageWidth,
      renderHeightPx: imageHeight,
      pageWidthPt: pageWidthPt,
      pageHeightPt: pageHeightPt,
    });

    // Ensure all required fields are present and finite numbers
    if (!Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt)) {
      setError("PDF page dimensions are invalid. Please reload the PDF.");
      setIsSaving(false);
      return;
    }

    try {
      const response = await fetch("/api/onboarding/templates/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fmKey: selectedFmKey,
          page: coordsPage, // Use coordsPage, not selectedPage
          // PDF points in x,y,w,h order (top-left origin)
          xPt: points.xPt,
          yPt: points.yPt,
          wPt: points.wPt,
          hPt: points.hPt,
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
          renderWidthPx: imageWidth,
          renderHeightPx: imageHeight,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save template");
      }

      setSuccess("Template saved successfully!");
      // Reload the template to update savedTemplate state
      await loadExistingTemplate();
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
    setCalculatedPoints(null);
    setCurrentViewport(null);
  }

  function handleApplyCalibratedCoords() {
    if (!selectedFmKey || !imageWidth || !imageHeight) {
      setError("Please select a facility sender and upload a PDF first");
      return;
    }

    const calibrated = calibratedCoordinates[selectedFmKey];
    if (!calibrated) {
      setError(`No calibrated coordinates found for "${selectedFmKey}"`);
      return;
    }

    // Apply calibrated coordinates
    setCropZone({
      x: calibrated.xPct * imageWidth,
      y: calibrated.yPct * imageHeight,
      width: calibrated.wPct * imageWidth,
      height: calibrated.hPct * imageHeight,
    });
    setCoordsPage(selectedPage);
    setManualCoords(null);
    setSuccess(`Applied calibrated coordinates for ${selectedFmKey}`);
    setError(null);
  }

  const percentages = calculatePercentages();

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-slate-900 text-slate-50 pt-8 p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-semibold mb-4">Capture Zones</h1>
          <p className="text-slate-300 mb-8">
            Upload a sample work order PDF and define where the Work Order Number is located for each facility sender.
            This allows the OCR system to extract work order numbers accurately.
          </p>

          <div className="space-y-6">
            {/* FM Profile Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="fmKey" className="block text-sm font-medium">
                  Facility Sender <span className="text-red-400">*</span>
                </label>
                <button
                  onClick={() => {
                    setShowAddFmForm(!showAddFmForm);
                    setError(null);
                    setSuccess(null);
                  }}
                  className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                  {showAddFmForm ? "Cancel" : "+ Add New Sender"}
                </button>
              </div>
              
              {/* Add New FM Form */}
              {showAddFmForm && (
                <div className="mb-4 p-4 bg-slate-800 border border-slate-700 rounded-lg">
                  <h3 className="text-sm font-semibold text-slate-200 mb-3">Create New Facility Sender</h3>
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="newFmKey" className="block text-xs text-slate-400 mb-1">
                        FM Key <span className="text-red-400">*</span>
                      </label>
                      <input
                        id="newFmKey"
                        type="text"
                        value={newFmKey}
                        onChange={(e) => setNewFmKey(e.target.value)}
                        placeholder="e.g., superclean, 23rdgroup"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        disabled={isCreatingFm}
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Will be normalized to lowercase (e.g., "Super Clean" → "super_clean")
                      </p>
                    </div>
                    <div>
                      <label htmlFor="newFmLabel" className="block text-xs text-slate-400 mb-1">
                        Display Label (optional)
                      </label>
                      <input
                        id="newFmLabel"
                        type="text"
                        value={newFmLabel}
                        onChange={(e) => setNewFmLabel(e.target.value)}
                        placeholder="e.g., Super Clean Services"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        disabled={isCreatingFm}
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        If empty, will use the normalized FM key
                      </p>
                    </div>
                    <div>
                      <label htmlFor="newFmDomain" className="block text-xs text-slate-400 mb-1">
                        FM Domain (optional)
                      </label>
                      <input
                        id="newFmDomain"
                        type="text"
                        value={newFmDomain}
                        onChange={(e) => setNewFmDomain(e.target.value)}
                        placeholder="e.g., superclean.com, 23rdgroup.com"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        disabled={isCreatingFm}
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Comma-separated list of sender email domains (e.g., "superclean.com, workorders@superclean.com")
                      </p>
                    </div>
                    <button
                      onClick={handleCreateFmProfile}
                      disabled={isCreatingFm || !newFmKey.trim()}
                      className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                    >
                      {isCreatingFm ? "Creating..." : "Create Facility Sender"}
                    </button>
                  </div>
                </div>
              )}

              {isLoadingProfiles ? (
                <div className="text-slate-400">Loading facility senders...</div>
              ) : fmProfiles.length === 0 ? (
                <div className="text-yellow-400">
                  No facility senders found. Use the "Add New Sender" button above to create one.
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
                  style={{ width: imageWidth, maxWidth: "100%" }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  <img
                    src={previewImage}
                    alt="PDF Preview"
                    style={{ display: "block", width: imageWidth, height: imageHeight }}
                    draggable={false}
                  />
                  {cropZone && cropZone.width > 0 && cropZone.height > 0 && (
                    <div
                      className="absolute border-2 border-sky-500 bg-sky-500/20 pointer-events-none"
                      style={{
                        left: `${cropZone.x}px`,
                        top: `${cropZone.y}px`,
                        width: `${cropZone.width}px`,
                        height: `${cropZone.height}px`,
                      }}
                    />
                  )}
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
            <div className="flex gap-4 flex-wrap">
              <button
                onClick={handleSave}
                disabled={
                  isSaving || 
                  !selectedFmKey || 
                  !previewImage || 
                  !cropZone || 
                  !percentages ||
                  coordsPage === null ||
                  coordsPage !== selectedPage
                }
                className="px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {isSaving ? "Saving..." : "Save Capture Zone"}
              </button>
              {cropZone && (
                <button
                  onClick={handleClearRectangle}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                >
                  Clear Rectangle
                </button>
              )}
              {previewImage && selectedFmKey && calibratedCoordinates[selectedFmKey] && (
                <button
                  onClick={handleApplyCalibratedCoords}
                  className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                  title={`Apply calibrated coordinates: x=${calibratedCoordinates[selectedFmKey].xPct}, y=${calibratedCoordinates[selectedFmKey].yPct}, w=${calibratedCoordinates[selectedFmKey].wPct}, h=${calibratedCoordinates[selectedFmKey].hPct}`}
                >
                  Apply Calibrated Coords
                </button>
              )}
            </div>
            {savedTemplate && (
              <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg text-green-200">
                <p className="font-medium mb-1">Capture Zone Saved</p>
                <p className="text-sm">
                  Capture zone for {savedTemplate.fmKey} is configured. You can edit it above or create zones for other facility senders.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function TemplateZonesPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
          <div className="max-w-6xl mx-auto">
            <div className="text-slate-300">Loading...</div>
          </div>
        </div>
      </AppShell>
    }>
      <TemplateZonesPageContent />
    </Suspense>
  );
}

