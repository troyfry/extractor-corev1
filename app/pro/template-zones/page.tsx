"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";
import { 
  cssPixelsToPdfPoints, 
  pdfPointsToCssPixels, 
  validatePdfPoints,
  assertPdfCropPointsValid,
  type BoundsPt,
  type PdfCropPoints
} from "@/lib/domain/coordinates/pdfPoints";

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
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  // No longer using pdf.js - using render-page API instead

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

  // Auto-dismiss success messages after 3 seconds
  useEffect(() => {
    if (success) {
      const timeoutId = setTimeout(() => {
        setSuccess(null);
      }, 3000); // 3 seconds

      return () => clearTimeout(timeoutId);
    }
  }, [success]);

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
        // ⚠️ USE LOCKED CONVERSION FUNCTION - DO NOT MODIFY
        // See lib/templates/templateCoordinateConversion.ts for implementation details
        const rect = imageContainerRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const cssPx = pdfPointsToCssPixels(
            {
              xPt: savedTemplate.xPt,
              yPt: savedTemplate.yPt,
              wPt: savedTemplate.wPt,
              hPt: savedTemplate.hPt,
            },
            { width: savedTemplate.pageWidthPt, height: savedTemplate.pageHeightPt },
            { width: imageWidth, height: imageHeight },
            { width: rect.width, height: rect.height },
            boundsPt
          );
          
          setCropZone(cssPx);
        } else {
          // Fallback if rect not available yet - try again after a short delay
          // This can happen if the image hasn't fully rendered yet
          const timeoutId = setTimeout(() => {
            const retryRect = imageContainerRef.current?.getBoundingClientRect();
            if (retryRect && retryRect.width > 0 && retryRect.height > 0) {
              const cssPx = pdfPointsToCssPixels(
                {
                  xPt: savedTemplate.xPt,
                  yPt: savedTemplate.yPt,
                  wPt: savedTemplate.wPt,
                  hPt: savedTemplate.hPt,
                },
                { width: savedTemplate.pageWidthPt, height: savedTemplate.pageHeightPt },
                { width: imageWidth, height: imageHeight },
                { width: retryRect.width, height: retryRect.height },
                boundsPt
              );
              setCropZone(cssPx);
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
          if (_pdfFile && template.page && template.page !== selectedPage) {
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
              // Convert PDF points to CSS pixels (top-left origin)
              // ⚠️ USE LOCKED CONVERSION FUNCTION - DO NOT MODIFY
              try {
                const rect = imageContainerRef.current?.getBoundingClientRect();
                if (rect && boundsPt) {
                  // Validate complete crop before conversion
                  const crop: PdfCropPoints = {
                    xPt: template.xPt,
                    yPt: template.yPt,
                    wPt: template.wPt,
                    hPt: template.hPt,
                    pageWidthPt: template.pageWidthPt,
                    pageHeightPt: template.pageHeightPt,
                    boundsPt: boundsPt,
                  };
                  assertPdfCropPointsValid(crop, `Template ${template.fmKey || "unknown"}`);
                  
                  // Use locked conversion function
                  const cssPx = pdfPointsToCssPixels(
                    { xPt: template.xPt, yPt: template.yPt, wPt: template.wPt, hPt: template.hPt },
                    { width: template.pageWidthPt, height: template.pageHeightPt },
                    { width: imageWidth, height: imageHeight },
                    { width: rect.width, height: rect.height },
                    boundsPt
                  );
                  
                  setCropZone({
                    x: cssPx.x,
                    y: cssPx.y,
                    width: cssPx.width,
                    height: cssPx.height,
                  });
                }
              } catch {
                // Image not loaded yet, will retry when image loads
                console.log("[Template Zones] Image rect not available yet for template conversion");
              }
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

    // ⚠️ VALIDATION: Block signed/phone-scan PDFs from template capture
    // Template capture must use ORIGINAL DIGITAL PDF only
    // Normalize filename: lowercase, spaces to underscores, remove special chars
    const fileNameLower = file.name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_\.]/g, "");
    const signedIndicators = [
      "signed",
      "signoff",
      "sign",
      "signature",
      "completed",
      "final",
      "executed",
      "proof",
      "kent", // Test files often include this
      "photo_scan",
      "scan_",
      "signed_",
      "scan",
      "scanned",
      "phone",
      "mobile",
      "camera",
      "photo",
      "image",
      "picture",
      "screenshot",
      "capture",
      "img_",
      "dsc",
      "pict",
    ];
    
    const appearsToBeSigned = signedIndicators.some(indicator => 
      fileNameLower.includes(indicator)
    );
    
    // Debug logging
    console.log("[Template Zones] Filename check:", {
      original: file.name,
      normalized: fileNameLower,
      appearsToBeSigned,
      matchedIndicators: signedIndicators.filter(ind => fileNameLower.includes(ind)),
    });
      
    // Helper function to block upload and clear state
    const blockUpload = (reason: string, errorMessage: string) => {
      console.log("[Template Zones] Rejecting PDF for capture", { reason, filename: file.name });
      setError(errorMessage);
      setPdfFile(null);
      setPreviewImage(null);
      setCropZone(null);
      e.target.value = "";
    };

    if (appearsToBeSigned) {
      blockUpload(
        "filename_heuristic",
        "Signed scans cannot be used for template capture. " +
        "Please upload the original digital work order PDF (the PDF file you received from the facility management system, not a phone scan or signed copy)."
      );
      return; // HARD BLOCK: Do not proceed to raster detection or renderPage
    }

    // ⚠️ STEP 2: RASTER DETECTION (AUTHORITATIVE BLOCKER)
    // This is the primary validation - checks if PDF has no text layer (raster/scan-only)
    try {
      const formData = new FormData();
      formData.append("pdf", file);
      
      const detectResponse = await fetch("/api/pdf/detect-raster", {
        method: "POST",
        body: formData,
      });
      
      if (!detectResponse.ok) {
        // If detection API fails, block upload (fail closed)
        const errorData = await detectResponse.json().catch(() => ({ error: "Failed to validate PDF" }));
        blockUpload(
          "raster_detection_api_failed",
          `PDF validation failed: ${errorData.error || "Unknown error"}. ` +
          "Please ensure you're uploading the original digital work order PDF."
        );
        return; // HARD BLOCK: Do not proceed to renderPage
      }
      
      const detectData = await detectResponse.json();
      if (detectData.isRasterOnly === true) {
        // Check for override flag (debug only)
        const allowOverride = new URLSearchParams(window.location.search).get("allowRaster") === "true";
        if (!allowOverride) {
          blockUpload(
            "raster_only_detected",
            "Template capture requires a digital PDF with text content. " +
            "This PDF appears to be raster/scan-only (no text layer). " +
            "Please use the original digital work order PDF from your facility management system."
          );
          return; // HARD BLOCK: Do not proceed to renderPage
        } else {
          console.warn("[Template Zones] Raster-only PDF allowed due to override flag");
        }
      }
    } catch (detectError) {
      // If detection throws, block upload (fail closed)
      console.error("[Template Zones] Raster detection error:", detectError);
      blockUpload(
        "raster_detection_error",
        "Failed to validate PDF. Please ensure you're uploading the original digital work order PDF (not a scan or signed copy)."
      );
      return; // HARD BLOCK: Do not proceed to renderPage
    }

    // ⚠️ STEP 3: PAGE DIMENSION VALIDATION (BLOCK NON-STANDARD SIZES)
    // Phone photo scans and unusual PDFs have non-standard page dimensions
    // Standard sizes: Letter (612x792), A4 (595x842), Legal (612x1008), etc.
    try {
      const pdfjs = await initPdfJsLib();
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      
      if (pdfDoc.numPages < 1) {
        blockUpload(
          "no_pages",
          "PDF has no pages. Please upload a valid work order PDF."
        );
        return; // HARD BLOCK
      }

      // Get first page dimensions
      const firstPage = await pdfDoc.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      const pageWidthPt = viewport.width;
      const pageHeightPt = viewport.height;

      // Use client-safe page dimension validation (doesn't import server-side code)
      const { validatePageDimensions } = await import("@/lib/templates/pageDimensions");
      const dimensionResult = validatePageDimensions(pageWidthPt, pageHeightPt);
      const matchesStandard = dimensionResult.isStandard;

      if (!matchesStandard) {
        // Check for override flag (debug only)
        const allowOverride = new URLSearchParams(window.location.search).get("allowNonStandardSize") === "true";
        if (!allowOverride) {
          blockUpload(
            "non_standard_page_size",
            `This PDF has non-standard page dimensions (${pageWidthPt.toFixed(1)} x ${pageHeightPt.toFixed(1)} points). ` +
            "Template capture requires standard page sizes (Letter, A4, Legal, etc.). " +
            "Phone photo scans and unusual PDFs are not supported. Please use the original digital work order PDF."
          );
          return; // HARD BLOCK: Do not proceed to renderPage
        } else {
          console.warn("[Template Zones] Non-standard page size allowed due to override flag", {
            width: pageWidthPt,
            height: pageHeightPt,
          });
        }
      } else {
        console.log("[Template Zones] Page dimensions validated:", {
          width: pageWidthPt,
          height: pageHeightPt,
          matchesStandard: true,
          matchedSize: dimensionResult.matchedSize,
        });
      }
    } catch (dimError) {
      // If dimension check fails, block upload (fail closed)
      console.error("[Template Zones] Page dimension validation error:", dimError);
      blockUpload(
        "page_dimension_check_error",
        "Failed to validate PDF page dimensions. Please ensure you're uploading the original digital work order PDF."
      );
      return; // HARD BLOCK: Do not proceed to renderPage
    }

    // ✅ VALIDATION PASSED: PDF is digital (has text layer), filename is clean, and page size is standard
    // Now proceed to render and allow template capture
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
      // ⚠️ IMPORTANT: Do NOT normalize PDFs for template capture
      // Template capture must use the ORIGINAL digital PDF coordinates
      // Use render-page API (same as onboarding) which respects skipNormalization
      setSelectedPage(1);
      setPageCount(1); // Will be updated when we get page count from API
      setPdfDoc(null);
      setCoordsPage(null);
      await renderPageWithPdfJs(file, 1);
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

  async function renderPageWithPdfJs(file: File, pageNum: number) {
    setIsRenderingPdf(true);
    setError(null);

    try {
      const pdfjs = await initPdfJsLib();
      const buf = await file.arrayBuffer();

      const loadingTask = pdfjs.getDocument({ data: buf });
      const doc = await loadingTask.promise;
      setPageCount(doc.numPages);
      setPdfDoc(doc);

      const page = await doc.getPage(pageNum);

      // 1.0 scale gives you "PDF points-ish" viewport units (1/72 inch)
      // but you can bump scale for clearer preview
      const scale = 2;
      const viewport = page.getViewport({ scale });

      // Canvas render
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context not available");

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Preview image
      const pngDataUrl = canvas.toDataURL("image/png");

      setPreviewImage(pngDataUrl);
      setImageWidth(canvas.width);
      setImageHeight(canvas.height);

      // PDF page size in points:
      // viewport.width/height at scale=1 equals points (PDF units) typically.
      const ptViewport = page.getViewport({ scale: 1 });
      setPageWidthPt(ptViewport.width);
      setPageHeightPt(ptViewport.height);

      // boundsPt: PDF.js assumes origin at top-left of viewport for rendering.
      // If your conversion code needs boundsPt, set a simple default:
      setBoundsPt({ x0: 0, y0: 0, x1: ptViewport.width, y1: ptViewport.height });

      // Clear viewport (no longer needed - we use proportional math)
      setCurrentViewport(null);

      console.log("[Template Zones] Rendered via PDF.js:", {
        pageNum,
        canvas: { w: canvas.width, h: canvas.height },
        pt: { w: ptViewport.width, h: ptViewport.height },
      });

      // If we have a saved template for this page, the useEffect will convert it to pixels
      // Otherwise, auto-apply calibrated coordinates if available (for new users)
      if (!savedTemplate && selectedFmKey && calibratedCoordinates[selectedFmKey]) {
        const calibrated = calibratedCoordinates[selectedFmKey];
        // Convert calibrated percentages to pixels using rendered image dimensions
        setCropZone({
          x: calibrated.xPct * canvas.width,
          y: calibrated.yPct * canvas.height,
          width: calibrated.wPct * canvas.width,
          height: calibrated.hPct * canvas.height,
        });
        setCoordsPage(pageNum);
        setSuccess(`Auto-applied calibrated coordinates for ${selectedFmKey}. Review and adjust if needed, then save.`);
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to render PDF with PDF.js");
      setPreviewImage(null);
      setPageWidthPt(0);
      setPageHeightPt(0);
      setBoundsPt(null);
    } finally {
      setIsRenderingPdf(false);
    }
  }

  async function handlePageChange(newPage: number) {
    if (!_pdfFile || newPage < 1 || newPage > pageCount) return;
    
    setSelectedPage(newPage);
    await renderPageWithPdfJs(_pdfFile, newPage);
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

    try {
      const rect = imageContainerRef.current.getBoundingClientRect();
      
      // ⚠️ USE LOCKED CONVERSION FUNCTION - DO NOT MODIFY
      // See lib/templates/templateCoordinateConversion.ts for implementation details
      const points = cssPixelsToPdfPoints(
        {
          x: cropZone.x,
          y: cropZone.y,
          width: cropZone.width,
          height: cropZone.height,
        },
        { width: rect.width, height: rect.height },
        { width: imageWidth, height: imageHeight },
        { width: pageWidthPt, height: pageHeightPt },
        boundsPt
      );
      
      return points;
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

    // Convert PDF points to CSS pixels
    // ⚠️ USE LOCKED CONVERSION FUNCTION - DO NOT MODIFY
    try {
      const rect = imageContainerRef.current?.getBoundingClientRect();
      if (!rect || !boundsPt) {
        setError("Image dimensions not available");
        return;
      }
      
      // Validate complete crop before conversion
      const crop: PdfCropPoints = {
        xPt,
        yPt,
        wPt,
        hPt,
        pageWidthPt,
        pageHeightPt,
        boundsPt,
      };
      assertPdfCropPointsValid(crop, "Manual points");
      
      // Use locked conversion function
      const cssPx = pdfPointsToCssPixels(
        { xPt, yPt, wPt, hPt },
        { width: pageWidthPt, height: pageHeightPt },
        { width: imageWidth, height: imageHeight },
        { width: rect.width, height: rect.height },
        boundsPt
      );
      
      // Use converted CSS pixels directly (conversion function handles bounds)
      setCropZone({
        x: cssPx.x,
        y: cssPx.y,
        width: cssPx.width,
        height: cssPx.height,
      });
      setCoordsPage(selectedPage);
      setManualPoints(null);
      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Invalid coordinates";
      setError(`Failed to apply manual points: ${errorMsg}`);
    }
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
    
    // ⚠️ USE LOCKED VALIDATION FUNCTION - DO NOT MODIFY
    // Enforce complete crop validation (points + page geometry)
    if (!boundsPt) {
      setError("PDF bounds not available. Please reload the PDF.");
      setIsSaving(false);
      return;
    }
    
    try {
      const crop: PdfCropPoints = {
        xPt: points.xPt,
        yPt: points.yPt,
        wPt: points.wPt,
        hPt: points.hPt,
        pageWidthPt,
        pageHeightPt,
        boundsPt,
      };
      assertPdfCropPointsValid(crop, selectedFmKey || "Template");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid coordinates");
      setIsSaving(false);
      return;
    }

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

    // Prepare region data for domain layer validation
    const regionData = {
      fmKey: selectedFmKey,
      page: coordsPage, // Use coordsPage, not selectedPage
      xPt: points.xPt,
      yPt: points.yPt,
      wPt: points.wPt,
      hPt: points.hPt,
      pageWidthPt: Number(pageWidthPt),
      pageHeightPt: Number(pageHeightPt),
      coordSystem: toSheetCoordSystem(COORD_SYSTEM_PDF_POINTS_TOP_LEFT),
    };
    
    // Note: Validation happens server-side in the API route
    // The API route uses the domain layer for validation

    try {
      const response = await fetch("/api/onboarding/templates/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...regionData,
          // Include filename for server-side validation (blocks signed/scan PDFs)
          originalFilename: _pdfFile?.name || undefined,
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

  async function handleDelete() {
    if (!selectedFmKey || !savedTemplate) {
      setError("No template selected to delete");
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/onboarding/templates/save?fmKey=${encodeURIComponent(selectedFmKey)}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete template");
      }

      setSuccess("Template deleted successfully!");
      setSavedTemplate(null);
      setCropZone(null);
      setShowDeleteConfirm(false);
      
      // Clear form
      setPreviewImage(null);
      setPdfFile(null);
      setPageWidthPt(0);
      setPageHeightPt(0);
      setBoundsPt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template");
    } finally {
      setIsDeleting(false);
    }
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
            <div className="flex gap-4 flex-wrap items-center">
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
              {savedTemplate && (
                <>
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isDeleting}
                      className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                    >
                      Delete Template
                    </button>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <span className="text-sm text-slate-300">Delete this template?</span>
                      <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
                      >
                        {isDeleting ? "Deleting..." : "Confirm"}
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={isDeleting}
                        className="px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-800 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
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

