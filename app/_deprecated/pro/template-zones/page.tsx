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
} from "@/lib/_deprecated/domain/coordinates/pdfPoints";

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

// PDF rendering now uses server-side MuPDF API (/api/pdf/render-page) with intent=TEMPLATE_CAPTURE
// This ensures consistent PDF Intent policy enforcement across all template capture flows

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
  const hasInitializedFromQuery = useRef<boolean>(false);
  const [manualCoords, setManualCoords] = useState<{ xPct: string; yPct: string; wPct: string; hPct: string } | null>(null);
  const [manualPoints, setManualPoints] = useState<{ xPt: string; yPt: string; wPt: string; hPt: string } | null>(null);
  const [calculatedPoints, setCalculatedPoints] = useState<{ xPt: number; yPt: number; wPt: number; hPt: number } | null>(null);
  const [showAddFmForm, setShowAddFmForm] = useState(false);
  const [isTestingExtract, setIsTestingExtract] = useState(false);
  const [testResult, setTestResult] = useState<{
    workOrderNumber?: string | null;
    woNumber?: string | null;
    extractedText?: string;
    rawText?: string;
    confidence?: number;
    confidenceRaw?: number;
    confidenceLabel?: string;
    snippetImageUrl?: string | null;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
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

    // ✅ VALIDATION PASSED: PDF is digital (has text layer) and filename is clean
    // Server-side rendering will handle page dimension validation and raster detection
    // Now proceed to render and allow template capture
    setPdfFile(file);
    setError(null);
    setSuccess(null);
    setPreviewImage(null);
    setImageWidth(0);
    setImageHeight(0);
    setCropZone(null);
    setCoordsPage(null);
    setSelectedPage(1);
    // Page count will be set from API response in renderPage()

    try {
      // Render first page using server-side MuPDF API with TEMPLATE_CAPTURE intent
      // This ensures server-side validation (raster detection, page dimensions) and consistent policy enforcement
      await renderPage(file, 1);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to render PDF";
      console.error("[PDF Render] Error:", err);
      setError(`Failed to render PDF: ${errorMessage}`);
      setPreviewImage(null);
      setCropZone(null);
      setPageWidthPt(0);
      setPageHeightPt(0);
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

  async function renderPage(file: File, pageNum: number) {
    setIsRenderingPdf(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("page", String(pageNum));
      formData.append("intent", "TEMPLATE_CAPTURE");

      const response = await fetch("/api/pdf/render-page", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to render PDF page" }));
        const errorMessage = errorData.error || "Failed to render PDF page";
        
        // Handle server-side validation errors (raster-only PDF, etc.)
        if (response.status === 400) {
          // Server blocked the PDF (raster-only, non-standard size, etc.)
          setError(errorMessage);
          setPdfFile(null);
          setPreviewImage(null);
          setCropZone(null);
          setPageWidthPt(0);
          setPageHeightPt(0);
          setBoundsPt(null);
          return;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Update state from API response
      setPreviewImage(data.pngDataUrl);
      setImageWidth(data.widthPx);
      setImageHeight(data.heightPx);
      setPageWidthPt(data.pageWidthPt);
      setPageHeightPt(data.pageHeightPt);
      setBoundsPt(data.boundsPt);
      setPageCount(data.totalPages); // Set total pages from API
      setSelectedPage(data.page); // Set current page from API

      console.log("[Template Zones] Rendered via MuPDF API:", {
        pageNum,
        page: data.page,
        totalPages: data.totalPages,
        imageSize: { w: data.widthPx, h: data.heightPx },
        pageSize: { w: data.pageWidthPt, h: data.pageHeightPt },
        boundsPt: data.boundsPt,
      });

      // If we have a saved template for this page, the useEffect will convert it to pixels
      // Otherwise, auto-apply calibrated coordinates if available (for new users)
      if (!savedTemplate && selectedFmKey && calibratedCoordinates[selectedFmKey]) {
        const calibrated = calibratedCoordinates[selectedFmKey];
        // Convert calibrated percentages to pixels using rendered image dimensions
        setCropZone({
          x: calibrated.xPct * data.widthPx,
          y: calibrated.yPct * data.heightPx,
          width: calibrated.wPct * data.widthPx,
          height: calibrated.hPct * data.heightPx,
        });
        setCoordsPage(pageNum);
        setSuccess(`Auto-applied calibrated coordinates for ${selectedFmKey}. Review and adjust if needed, then save.`);
      }
    } catch (e: any) {
      console.error("[Template Zones] Render error:", e);
      setError(e?.message || "Failed to render PDF");
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
    await renderPage(_pdfFile, newPage);
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

  async function handleTestExtract() {
    // Prevent double-submit
    if (isTestingExtract) return;

    // Same validation as handleSave
    if (!selectedFmKey) {
      setTestError("Please select a facility sender");
      return;
    }

    if (!_pdfFile) {
      setTestError("Please upload a PDF file");
      return;
    }

    if (!previewImage || !cropZone) {
      setTestError("Please draw a crop zone first");
      return;
    }

    if (cropZone.width <= 0 || cropZone.height <= 0) {
      setTestError("Invalid crop zone");
      return;
    }

    if (!pageWidthPt || !pageHeightPt || !boundsPt) {
      setTestError("PDF page dimensions not available");
      return;
    }

    if (coordsPage !== selectedPage) {
      setTestError("Crop zone is on a different page. Please draw a rectangle on the current page.");
      return;
    }

    setIsTestingExtract(true);
    setTestError(null);
    setTestResult(null);

    try {
      // Use the same points conversion as handleSave
      if (!imageContainerRef.current) {
        throw new Error("Image container not available");
      }

      const displayedRect = imageContainerRef.current.getBoundingClientRect();
      const renderedWidthPx = imageWidth;
      const renderedHeightPx = imageHeight;

      const { xPt, yPt, wPt, hPt } = cssPixelsToPdfPoints(
        {
          x: cropZone.x,
          y: cropZone.y,
          width: cropZone.width,
          height: cropZone.height,
        },
        { width: displayedRect.width, height: displayedRect.height },
        { width: renderedWidthPx, height: renderedHeightPx },
        { width: pageWidthPt, height: pageHeightPt },
        boundsPt
      );

      // Validate points
      const crop: PdfCropPoints = {
        xPt,
        yPt,
        wPt,
        hPt,
        pageWidthPt,
        pageHeightPt,
        boundsPt,
      };
      assertPdfCropPointsValid(crop, selectedFmKey);

      // Build FormData for OCR service
      const formData = new FormData();
      formData.append("file", _pdfFile);
      formData.append("templateId", selectedFmKey); // Use fmKey as templateId
      formData.append("page", String(selectedPage));
      formData.append("dpi", "200");
      formData.append("xPt", String(xPt));
      formData.append("yPt", String(yPt));
      formData.append("wPt", String(wPt));
      formData.append("hPt", String(hPt));
      formData.append("pageWidthPt", String(pageWidthPt));
      formData.append("pageHeightPt", String(pageHeightPt));

      // Use Next.js API route to proxy OCR request
      const ocrEndpoint = "/api/ocr/test-extract";

      console.log("[Test Extract] Calling OCR service:", {
        endpoint: ocrEndpoint,
        templateId: selectedFmKey,
        page: selectedPage,
        points: { xPt, yPt, wPt, hPt },
        pageDims: { pageWidthPt, pageHeightPt },
      });

      const response = await fetch(ocrEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `OCR service returned ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log("[Test Extract] OCR result:", result);

      // Normalize response format (handle different field names)
      setTestResult({
        workOrderNumber: result.workOrderNumber || result.woNumber || null,
        woNumber: result.woNumber || result.workOrderNumber || null,
        extractedText: result.extractedText || result.rawText || "",
        rawText: result.rawText || result.extractedText || "",
        confidence: result.confidence || result.confidenceRaw,
        confidenceRaw: result.confidenceRaw || result.confidence,
        confidenceLabel: result.confidenceLabel,
        snippetImageUrl: result.snippetImageUrl || null,
      });
    } catch (err) {
      console.error("[Test Extract] Error:", err);
      setTestError(err instanceof Error ? err.message : "Failed to test extract");
    } finally {
      setIsTestingExtract(false);
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
    setTestResult(null);
    setTestError(null);
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

            {/* Test Extract Result */}
            {testError && (
              <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-200">
                <p className="font-medium mb-1">Test Extract Error</p>
                <p className="text-sm">{testError}</p>
              </div>
            )}

            {testResult && (
              <div className="p-4 bg-purple-900/20 border border-purple-700 rounded-lg text-purple-200">
                <p className="font-medium mb-2">Test Extract Result</p>
                {(testResult.workOrderNumber || testResult.woNumber) && (
                  <p className="text-sm mb-1">
                    <span className="font-semibold">Work Order Number:</span>{" "}
                    {testResult.workOrderNumber || testResult.woNumber}
                  </p>
                )}
                {(testResult.confidence !== undefined || testResult.confidenceRaw !== undefined) && (
                  <p className="text-sm mb-1">
                    <span className="font-semibold">Confidence:</span>{" "}
                    {testResult.confidenceLabel && (
                      <span className="uppercase">{testResult.confidenceLabel} </span>
                    )}
                    ({((testResult.confidenceRaw || testResult.confidence || 0) * 100).toFixed(1)}%)
                  </p>
                )}
                {(testResult.rawText || testResult.extractedText) && (
                  <p className="text-sm mb-2">
                    <span className="font-semibold">Extracted Text:</span>{" "}
                    <span className="font-mono text-xs bg-slate-800/50 px-2 py-1 rounded">
                      {testResult.rawText || testResult.extractedText}
                    </span>
                  </p>
                )}
                {testResult.snippetImageUrl && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold mb-1">Snippet Preview:</p>
                    <img
                      src={testResult.snippetImageUrl}
                      alt="OCR snippet"
                      className="max-w-md border border-purple-600 rounded"
                    />
                  </div>
                )}
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
              <button
                onClick={handleTestExtract}
                disabled={
                  isTestingExtract ||
                  !selectedFmKey ||
                  !previewImage ||
                  !cropZone ||
                  cropZone.width <= 0 ||
                  cropZone.height <= 0 ||
                  !pageWidthPt ||
                  !pageHeightPt ||
                  !boundsPt ||
                  coordsPage === null ||
                  coordsPage !== selectedPage
                }
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {isTestingExtract ? "Testing..." : "Test Extract"}
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

