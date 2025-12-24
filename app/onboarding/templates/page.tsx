"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// pdf.js - will be loaded dynamically using ESM legacy build
let pdfjsLibPromise: Promise<any> | null = null;

// Shared helper to initialize pdf.js (used by both useEffect and handleFileUpload)
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
      // @ts-ignore - TypeScript doesn't recognize this path, but it exists at runtime
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
  const [fmProfiles, setFmProfiles] = useState<FmProfile[]>([]);
  const [selectedFmKey, setSelectedFmKey] = useState<string>("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState<number>(0);
  const [imageHeight, setImageHeight] = useState<number>(0);
  const [cropZone, setCropZone] = useState<CropZone | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [savedTemplate, setSavedTemplate] = useState<Template | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [pageCount, setPageCount] = useState<number>(0);
  const [coordsPage, setCoordsPage] = useState<number | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);

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

  // When image loads, convert saved template percentages to pixels (only if on the correct page)
  useEffect(() => {
    if (previewImage && imageWidth > 0 && imageHeight > 0 && savedTemplate && savedTemplate.page === selectedPage) {
      setCropZone({
        x: savedTemplate.xPct * imageWidth,
        y: savedTemplate.yPct * imageHeight,
        width: savedTemplate.wPct * imageWidth,
        height: savedTemplate.hPct * imageHeight,
      });
      setCoordsPage(savedTemplate.page);
    } else if (savedTemplate && savedTemplate.page !== selectedPage) {
      // Clear crop zone if we're on a different page than the saved template
      setCropZone(null);
      setCoordsPage(null);
    }
  }, [previewImage, imageWidth, imageHeight, savedTemplate, selectedPage]);

  async function loadFmProfiles() {
    setIsLoadingProfiles(true);
    setError(null);
    try {
      const response = await fetch("/api/fm-profiles");
      if (response.ok) {
        const data = await response.json();
        const profiles = (data.profiles || []) as FmProfile[];
        setFmProfiles(profiles);
        if (profiles.length > 0 && !selectedFmKey) {
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
          
          // Convert percentages to pixel coordinates if we have an image
          if (previewImage && imageWidth > 0 && imageHeight > 0 && template.page === selectedPage) {
            setCropZone({
              x: template.xPct * imageWidth,
              y: template.yPct * imageHeight,
              width: template.wPct * imageWidth,
              height: template.hPct * imageHeight,
            });
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

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!previewImage || !imageContainerRef.current) return;

    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clamp to image bounds
    const clampedX = Math.max(0, Math.min(x, imageWidth));
    const clampedY = Math.max(0, Math.min(y, imageHeight));

    setIsSelecting(true);
    setStartPos({ x: clampedX, y: clampedY });
    setCropZone({
      x: clampedX,
      y: clampedY,
      width: 0,
      height: 0,
    });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isSelecting || !startPos || !previewImage || !imageContainerRef.current) return;

    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clamp to image bounds
    const clampedX = Math.max(0, Math.min(x, imageWidth));
    const clampedY = Math.max(0, Math.min(y, imageHeight));

    const width = clampedX - startPos.x;
    const height = clampedY - startPos.y;

    setCropZone({
      x: width < 0 ? clampedX : startPos.x,
      y: height < 0 ? clampedY : startPos.y,
      width: Math.abs(width),
      height: Math.abs(height),
    });
  }

  async function renderPage(pdf: any, pageNum: number) {
    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 }); // Scale for better quality

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
      setImageWidth(viewport.width);
      setImageHeight(viewport.height);
      
      // If we have a saved template for this page, the useEffect will convert it to pixels
      // Otherwise, cropZone will remain null for user to draw
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to render PDF page";
      console.error("[PDF Render] Error:", err);
      setError(`Failed to render PDF page ${pageNum}: ${errorMessage}`);
      setPreviewImage(null);
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

    const percentages = calculatePercentages();
    if (!percentages) {
      setError("Invalid crop zone");
      return;
    }

    // Validate crop zone is not default/full-page
    const TOLERANCE = 0.01;
    if (Math.abs(percentages.xPct) < TOLERANCE &&
        Math.abs(percentages.yPct) < TOLERANCE &&
        Math.abs(percentages.wPct - 1) < TOLERANCE &&
        Math.abs(percentages.hPct - 1) < TOLERANCE) {
      setError("Crop zone cannot be the full page. Please select a specific region.");
      return;
    }

    // Validate crop zone is not too small
    if (percentages.wPct < 0.01 || percentages.hPct < 0.01) {
      setError("Crop zone is too small. Please select a larger region.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/onboarding/templates/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fmKey: selectedFmKey,
          page: coordsPage, // Use coordsPage, not selectedPage
          ...percentages,
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

              {/* Percentages Display */}
              {percentages && (
                <div className="mt-4 p-4 bg-slate-800 rounded-lg">
                  <div className="text-sm font-medium mb-2">Crop Zone Percentages:</div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">xPct:</span>{" "}
                      <span className="font-mono">{percentages.xPct.toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">yPct:</span>{" "}
                      <span className="font-mono">{percentages.yPct.toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">wPct:</span>{" "}
                      <span className="font-mono">{percentages.wPct.toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">hPct:</span>{" "}
                      <span className="font-mono">{percentages.hPct.toFixed(4)}</span>
                    </div>
                  </div>
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
                !percentages ||
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
                onClick={() => router.push("/onboarding/done")}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
              >
                Continue to Next Step →
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

