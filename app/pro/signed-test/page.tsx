"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";

type PageInfo = {
  pageNumber: number;
  image: string;
  width: number;
  height: number;
};

export default function SignedTestPage() {
  const [fmKey, setFmKey] = useState("superclean");
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [loadingPages, setLoadingPages] = useState(false);
  const [responses, setResponses] = useState<Map<number, any>>(new Map());
  const [processingPages, setProcessingPages] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Load PDF info when file changes
  useEffect(() => {
    if (!file) {
      setPageCount(null);
      setPages([]);
      setSelectedPages(new Set());
      setResponses(new Map());
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadPdfInfo() {
      setLoadingPages(true);
      setError(null);
      
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/pdf/info", {
          method: "POST",
          body: formData,
        });

        if (cancelled) return;

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: "Failed to load PDF" }));
          setError(errorData.error || `Failed to load PDF (${res.status})`);
          setLoadingPages(false);
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        const totalPages = data.pageCount || 1;
        setPageCount(totalPages);

        // Load all pages
        const pagePromises: Promise<PageInfo>[] = [];
        for (let i = 1; i <= totalPages; i++) {
          pagePromises.push(
            fetch("/api/pdf/info", {
              method: "POST",
              body: (() => {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("page", String(i));
                return fd;
              })(),
            })
              .then((r) => {
                if (cancelled) throw new Error("Cancelled");
                if (!r.ok) throw new Error(`Failed to load page ${i}`);
                return r.json();
              })
              .then((pageData) => {
                if (cancelled) throw new Error("Cancelled");
                return {
                  pageNumber: i,
                  image: pageData.pageImage || "",
                  width: pageData.pageWidth || 0,
                  height: pageData.pageHeight || 0,
                };
              })
          );
        }

        const loadedPages = await Promise.all(pagePromises);
        if (cancelled) return;

        setPages(loadedPages);
        // Auto-select all pages
        setSelectedPages(new Set(Array.from({ length: totalPages }, (_, i) => i + 1)));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "An error occurred while loading PDF");
        console.error("[Signed Test] Error loading PDF:", err);
      } finally {
        if (!cancelled) {
          setLoadingPages(false);
        }
      }
    }

    loadPdfInfo();

    return () => {
      cancelled = true;
    };
  }, [file]);

  function togglePageSelection(pageNumber: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageNumber)) {
        next.delete(pageNumber);
      } else {
        next.add(pageNumber);
      }
      return next;
    });
  }

  function selectAllPages() {
    if (pageCount) {
      setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
    }
  }

  function deselectAllPages() {
    setSelectedPages(new Set());
  }

  async function processPage(pageNumber: number) {
    if (!file) return;

    setProcessingPages((prev) => new Set(prev).add(pageNumber));
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fmKey", fmKey);
      formData.append("page", String(pageNumber));

      const res = await fetch("/api/signed/process", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to process page" }));
        setError(`Page ${pageNumber}: ${errorData.error || "Failed to process"}`);
        return;
      }

      const json = await res.json();
      setResponses((prev) => new Map(prev).set(pageNumber, json));
    } catch (err) {
      setError(`Page ${pageNumber}: ${err instanceof Error ? err.message : "An error occurred"}`);
    } finally {
      setProcessingPages((prev) => {
        const next = new Set(prev);
        next.delete(pageNumber);
        return next;
      });
    }
  }

  async function processSelectedPages() {
    if (selectedPages.size === 0) {
      setError("Please select at least one page to process.");
      return;
    }

    for (const pageNumber of selectedPages) {
      await processPage(pageNumber);
    }
  }

  return (
    <AppShell>
      <MainNavigation currentMode="signed" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">
              Signed Work Orders
            </h1>
            <p className="text-sm text-gray-400">
              Upload a signed work order PDF to match it with existing work orders and update their status.
            </p>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    FM Key
                  </label>
                  <select
                    value={fmKey}
                    onChange={(e) => setFmKey(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="superclean">superclean</option>
                    <option value="23rd_group">23rd_group</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    Select the FM profile that matches this signed work order
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Upload Signed PDF
                  </label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                  />
                  {file && (
                    <p className="mt-2 text-sm text-gray-400">
                      Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
                      {pageCount && ` • ${pageCount} page${pageCount > 1 ? "s" : ""}`}
                    </p>
                  )}
                </div>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                  {error}
                </div>
              )}

              {file && !loadingPages && pages.length === 0 && !error && (
                <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded text-yellow-300 text-sm">
                  PDF uploaded. Pages will appear here once loaded...
                </div>
              )}
            </div>

            {/* PDF Pages Preview */}
            {loadingPages && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <p className="text-gray-400">Loading PDF pages...</p>
                </div>
              </div>
            )}

            {!file && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <p className="text-gray-400 text-center py-4">
                  Upload a PDF file above to view and process pages
                </p>
              </div>
            )}

            {pages.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white">
                    PDF Pages ({pages.length})
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={selectAllPages}
                      className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                    >
                      Select All
                    </button>
                    <button
                      onClick={deselectAllPages}
                      className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                    >
                      Deselect All
                    </button>
                    <button
                      onClick={processSelectedPages}
                      disabled={selectedPages.size === 0 || processingPages.size > 0}
                      className="px-4 py-1 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
                    >
                      Process Selected ({selectedPages.size})
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pages.map((page) => {
                    const isSelected = selectedPages.has(page.pageNumber);
                    const isProcessing = processingPages.has(page.pageNumber);
                    const response = responses.get(page.pageNumber);

                    return (
                      <div
                        key={page.pageNumber}
                        className={`border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
                          isSelected
                            ? "border-blue-500 bg-blue-900/20"
                            : "border-gray-700 bg-gray-900/50"
                        }`}
                        onClick={() => togglePageSelection(page.pageNumber)}
                      >
                        <div className="relative">
                          <img
                            src={page.image}
                            alt={`Page ${page.pageNumber}`}
                            className="w-full h-auto"
                            style={{ maxHeight: "300px", objectFit: "contain" }}
                          />
                          <div className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-xs font-semibold">
                            Page {page.pageNumber}
                          </div>
                          {isSelected && (
                            <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-1 rounded text-xs font-semibold">
                              ✓ Selected
                            </div>
                          )}
                        </div>
                        <div className="p-3 bg-gray-900/50">
                          <div className="flex items-center justify-between">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                processPage(page.pageNumber);
                              }}
                              disabled={isProcessing}
                              className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
                            >
                              {isProcessing ? "Processing..." : "Process"}
                            </button>
                            {response && (
                              <span
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                  response.mode === "UPDATED"
                                    ? "bg-green-900 text-green-300"
                                    : "bg-yellow-900 text-yellow-300"
                                }`}
                              >
                                {response.mode === "UPDATED" ? "✓ Updated" : "⚠ Review"}
                              </span>
                            )}
                          </div>
                          {response?.data?.woNumber && (
                            <p className="mt-2 text-xs text-gray-400">
                              WO: <span className="font-mono">{response.data.woNumber}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Detailed Results */}
          {responses.size > 0 && (
            <div className="mt-8 space-y-6">
              <h2 className="text-xl font-semibold text-white">Processing Results</h2>
              {Array.from(responses.entries()).map(([pageNumber, response]) => (
                <div key={pageNumber} className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Page {pageNumber} Result
                  </h3>
                  <div className="mb-4">
                    <span
                      className="inline-block px-3 py-1 rounded text-sm font-medium mb-2"
                      style={{
                        backgroundColor: response.mode === "UPDATED" ? "#065f46" : "#7c2d12",
                        color: response.mode === "UPDATED" ? "#6ee7b7" : "#fdba74",
                      }}
                    >
                      {response.mode === "UPDATED" ? "✓ Auto-Updated" : "⚠ Needs Review"}
                    </span>
                    {response.data?.woNumber && (
                      <p className="text-gray-300 mt-2">
                        Work Order Number:{" "}
                        <span className="font-mono font-semibold">{response.data.woNumber}</span>
                      </p>
                    )}
                  </div>

                  {response.data && (
                    <div className="mt-6 p-4 bg-gray-900 rounded border border-gray-700">
                      <h4 className="text-md font-semibold text-white mb-4">Confidence Analysis</h4>
                      <div className="space-y-3">
                        <div>
                          <span className="text-sm text-gray-400">Raw Confidence: </span>
                          <span className="text-blue-400 font-mono font-semibold">
                            {(response.data.confidenceRaw * 100).toFixed(2)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-sm text-gray-400">Confidence Label: </span>
                          <span
                            className={`font-bold uppercase px-2 py-1 rounded text-sm ${
                              response.data.confidenceLabel === "high"
                                ? "bg-green-900 text-green-300"
                                : response.data.confidenceLabel === "medium"
                                ? "bg-yellow-900 text-yellow-300"
                                : "bg-red-900 text-red-300"
                            }`}
                          >
                            {response.data.confidenceLabel}
                          </span>
                        </div>
                        <div className="mt-4 pt-4 border-t border-gray-700">
                          <div className="text-xs text-gray-500 mb-2">Thresholds:</div>
                          <div className="text-xs text-gray-400 space-y-1">
                            <div>• High: ≥ 90% (clear match - auto-update)</div>
                            <div>• Medium: ≥ 60% (somewhat reliable - auto-update)</div>
                            <div>• Low: &lt; 60% (needs manual review)</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {response.data?.signedPdfUrl && (
                    <div className="mt-4">
                      <a
                        href={response.data.signedPdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-sm underline"
                      >
                        View Signed PDF on Drive →
                      </a>
                    </div>
                  )}

                  <details className="mt-6">
                    <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
                      View Full Response JSON
                    </summary>
                    <pre className="mt-2 p-4 bg-gray-950 rounded text-xs text-green-400 overflow-auto border border-gray-800">
                      {JSON.stringify(response, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
