"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";

type FileInfo = {
  id: string;
  file: File;
  name: string;
  size: number;
};

export default function SignedTestPage() {
  const [fmKey, setFmKey] = useState("superclean");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [responses, setResponses] = useState<Map<string, any>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [overridingFileId, setOverridingFileId] = useState<string | null>(null);
  const [overrideErrors, setOverrideErrors] = useState<Map<string, string>>(new Map());
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const newFiles: FileInfo[] = selectedFiles.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      name: file.name,
      size: file.size,
    }));

    setFiles((prev) => [...prev, ...newFiles]);
    // Auto-select newly uploaded files
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      newFiles.forEach((f) => next.add(f.id));
      return next;
    });
  }

  function toggleFileSelection(fileId: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }

  function selectAllFiles() {
    setSelectedFiles(new Set(files.map((f) => f.id)));
  }

  function deselectAllFiles() {
    setSelectedFiles(new Set());
  }

  function removeFile(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
    setResponses((prev) => {
      const next = new Map(prev);
      next.delete(fileId);
      return next;
    });
  }

  async function processFile(fileInfo: FileInfo) {
    setProcessingFiles((prev) => new Set(prev).add(fileInfo.id));
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", fileInfo.file);
      formData.append("fmKey", fmKey);
      formData.append("page", "1"); // Always process page 1 for single-page PDFs

      const res = await fetch("/api/signed/process", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to process" }));
        setError(`${fileInfo.name}: ${errorData.error || "Failed to process"}`);
        return;
      }

      const json = await res.json();
      setResponses((prev) => new Map(prev).set(fileInfo.id, json));
    } catch (err) {
      setError(`${fileInfo.name}: ${err instanceof Error ? err.message : "An error occurred"}`);
    } finally {
      setProcessingFiles((prev) => {
        const next = new Set(prev);
        next.delete(fileInfo.id);
        return next;
      });
    }
  }

  async function processSelectedFiles() {
    if (selectedFiles.size === 0) {
      setError("Please select at least one file to process.");
      return;
    }

    const filesToProcess = files.filter((f) => selectedFiles.has(f.id));
    const total = filesToProcess.length;

    for (let i = 0; i < filesToProcess.length; i++) {
      const fileInfo = filesToProcess[i];
      setError(`Processing ${i + 1} of ${total}: ${fileInfo.name}...`);
      await processFile(fileInfo);
    }

    setError(null);
  }

  async function processAllFiles() {
    if (files.length === 0) {
      setError("No files to process.");
      return;
    }

    // Select all files first
    setSelectedFiles(new Set(files.map((f) => f.id)));

    // Wait a moment for state to update
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Process all files
    const total = files.length;
    for (let i = 0; i < files.length; i++) {
      const fileInfo = files[i];
      setError(`Processing ${i + 1} of ${total}: ${fileInfo.name}...`);
      await processFile(fileInfo);
    }

    setError(null);
  }

  async function handleOverride(fileId: string, response: any) {
    if (!response.data?.woNumber || !response.data?.signedPdfUrl) {
      setError("Cannot override: missing work order number or signed PDF URL.");
      return;
    }

      setOverridingFileId(fileId);
    setError(null);
    setOverrideErrors((prev) => {
      const next = new Map(prev);
      next.delete(fileId);
      return next;
    });

    try {
      const res = await fetch("/api/signed/override", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          woNumber: response.data.woNumber,
          fmKey: fmKey,
          signedPdfUrl: response.data.signedPdfUrl,
          signedPreviewImageUrl: response.data.snippetDriveUrl || response.data.snippetImageUrl,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to override" }));
        const errorMessage = errorData.error || "Failed to override";
        setOverrideErrors((prev) => new Map(prev).set(fileId, errorMessage));
        throw new Error(errorMessage);
      }

      const json = await res.json();
      
      // Clear any previous errors
      setOverrideErrors((prev) => {
        const next = new Map(prev);
        next.delete(fileId);
        return next;
      });
      
      // Update the response to show as UPDATED
      setResponses((prev) => {
        const next = new Map(prev);
        const updatedResponse = {
          ...response,
          mode: "UPDATED",
          overrideSuccess: true,
        };
        next.set(fileId, updatedResponse);
        return next;
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred";
      setOverrideErrors((prev) => new Map(prev).set(fileId, errorMessage));
      setError(`Override failed: ${errorMessage}`);
    } finally {
      setOverridingFileId(null);
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
                    Upload Signed PDFs
                  </label>
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    You can upload multiple PDF files at once (one work order per PDF)
                  </p>
                </div>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                  {error}
                </div>
              )}
            </div>

            {files.length > 0 && (
              <>
                {/* Processing Summary */}
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-300">
                        {files.length} file{files.length > 1 ? "s" : ""} uploaded
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {responses.size} of {files.length} processed
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {Array.from(responses.values()).filter(r => r.mode === "UPDATED").length > 0 && (
                        <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs">
                          ✓ {Array.from(responses.values()).filter(r => r.mode === "UPDATED").length} Updated
                        </span>
                      )}
                      {Array.from(responses.values()).filter(r => r.mode === "NEEDS_REVIEW").length > 0 && (
                        <span className="px-2 py-1 bg-yellow-900 text-yellow-300 rounded text-xs">
                          ⚠ {Array.from(responses.values()).filter(r => r.mode === "NEEDS_REVIEW").length} Need Review
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white">
                      Uploaded Files ({files.length})
                    </h2>
                    <div className="flex gap-2">
                      <button
                        onClick={selectAllFiles}
                        className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={deselectAllFiles}
                        className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                      >
                        Deselect All
                      </button>
                      <button
                        onClick={processAllFiles}
                        disabled={processingFiles.size > 0 || files.length === 0}
                        className="px-4 py-1 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors font-semibold"
                      >
                        Process All
                      </button>
                      <button
                        onClick={processSelectedFiles}
                        disabled={selectedFiles.size === 0 || processingFiles.size > 0}
                        className="px-4 py-1 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
                      >
                        Process Selected ({selectedFiles.size})
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {files.map((fileInfo) => {
                      const isSelected = selectedFiles.has(fileInfo.id);
                      const isProcessing = processingFiles.has(fileInfo.id);
                      const response = responses.get(fileInfo.id);

                      return (
                        <div
                          key={fileInfo.id}
                          className={`border-2 rounded-lg p-4 transition-all ${
                            isSelected
                              ? "border-blue-500 bg-blue-900/20"
                              : "border-gray-700 bg-gray-900/50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleFileSelection(fileInfo.id)}
                                className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-300 truncate">{fileInfo.name}</p>
                                <p className="text-xs text-gray-400">
                                  {(fileInfo.size / 1024).toFixed(2)} KB
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
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
                              <button
                                onClick={() => processFile(fileInfo)}
                                disabled={isProcessing}
                                className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
                              >
                                {isProcessing ? "Processing..." : "Process"}
                              </button>
                              <button
                                onClick={() => removeFile(fileInfo.id)}
                                className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          {response?.data?.woNumber && (
                            <p className="mt-2 text-xs text-gray-400">
                              WO: <span className="font-mono">{response.data.woNumber}</span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {files.length === 0 && (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                <p className="text-gray-400 text-center py-4">
                  Upload PDF files above to process signed work orders
                </p>
              </div>
            )}
          </div>

          {/* Detailed Results */}
          {responses.size > 0 && (
            <div className="mt-8 space-y-6">
              <h2 className="text-xl font-semibold text-white">Processing Results</h2>
              {Array.from(responses.entries()).map(([fileId, response]) => {
                const fileInfo = files.find((f) => f.id === fileId);
                const isExpanded = expandedResults.has(fileId);
                return (
                  <div key={fileId} className="bg-gray-800 rounded-lg border border-gray-700">
                    <button
                      onClick={() => {
                        setExpandedResults((prev) => {
                          const next = new Set(prev);
                          if (next.has(fileId)) {
                            next.delete(fileId);
                          } else {
                            next.add(fileId);
                          }
                          return next;
                        });
                      }}
                      className="w-full flex items-center justify-between p-6 text-left hover:bg-gray-750 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                        <h3 className="text-lg font-semibold text-white">
                          {fileInfo?.name || "Unknown File"}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded text-sm font-medium ${
                            response.mode === "UPDATED"
                              ? "bg-green-900 text-green-300"
                              : "bg-yellow-900 text-yellow-300"
                          }`}
                        >
                          {response.mode === "UPDATED" ? "✓ Updated" : "⚠ Needs Review"}
                        </span>
                        {response.data?.woNumber && (
                          <span className="text-sm text-gray-400 font-mono">
                            WO: {response.data.woNumber}
                          </span>
                        )}
                      </div>
                    </button>
                    
                    {isExpanded && (
                      <div className="px-6 pb-6 space-y-6">

                  {/* Snippet Image - Show for needs-review so user can verify */}
                  {response.mode === "NEEDS_REVIEW" && (response.data?.snippetImageUrl || response.data?.snippetDriveUrl) && (
                    <div className="mt-6 p-4 bg-gray-900 rounded border border-gray-700">
                      <h4 className="text-md font-semibold text-white mb-4">Work Order Snippet</h4>
                      <p className="text-sm text-gray-400 mb-3">
                        Review the snippet below to verify the work order number. If it's clear, click "Update This One" to manually override.
                      </p>
                      <div className="bg-gray-950 rounded border border-gray-800 p-2">
                        {(() => {
                          // Prefer Drive URL, but fall back to base64 if Drive upload failed
                          const snippetUrl = response.data.snippetDriveUrl || response.data.snippetImageUrl;
                          
                          if (!snippetUrl) {
                            return (
                              <p className="text-gray-500 text-sm p-4 text-center">
                                No snippet image available
                              </p>
                            );
                          }
                          
                          let directImageUrl = snippetUrl;
                          
                          // Handle base64 data URLs - use directly
                          if (snippetUrl.startsWith("data:image")) {
                            directImageUrl = snippetUrl;
                          }
                          // Handle Google Drive URLs - convert to direct image link
                          else if (snippetUrl.includes("drive.google.com")) {
                            // Try to extract file ID from various Google Drive URL formats
                            const fileIdMatch = snippetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                                              snippetUrl.match(/id=([a-zA-Z0-9_-]+)/) ||
                                              snippetUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                            
                            if (fileIdMatch) {
                              const fileId = fileIdMatch[1];
                              // Use the thumbnail format which is more reliable for public images
                              directImageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
                            }
                          }
                          
                          return (
                            <img
                              src={directImageUrl}
                              alt="Work order snippet"
                              className="max-w-full h-auto rounded object-contain mx-auto block"
                              style={{ maxHeight: "200px", maxWidth: "300px" }}
                              onError={(e) => {
                                console.error("Failed to load snippet image:", {
                                  original: snippetUrl,
                                  converted: directImageUrl,
                                  woNumber: response.data?.woNumber,
                                  hasDriveUrl: !!response.data.snippetDriveUrl,
                                  hasBase64Url: !!response.data.snippetImageUrl,
                                });
                                
                                // If we tried Drive URL and it failed, try base64 fallback
                                if (directImageUrl !== snippetUrl && response.data.snippetImageUrl && response.data.snippetImageUrl.startsWith("data:image")) {
                                  console.log("Trying base64 fallback URL");
                                  e.currentTarget.src = response.data.snippetImageUrl;
                                  return;
                                }
                                
                                // Try original URL as last resort
                                if (e.currentTarget.src !== snippetUrl && snippetUrl) {
                                  e.currentTarget.src = snippetUrl;
                                  return;
                                }
                                
                                // Hide broken image if all attempts fail
                                e.currentTarget.style.display = "none";
                                const parent = e.currentTarget.parentElement;
                                if (parent) {
                                  parent.innerHTML = '<p class="text-gray-500 text-sm p-4 text-center">Image unavailable. Check console for details.</p>';
                                }
                              }}
                              onLoad={() => {
                                console.log("Successfully loaded snippet image:", {
                                  woNumber: response.data?.woNumber,
                                  url: directImageUrl,
                                  source: directImageUrl.startsWith("data:") ? "base64" : "drive",
                                });
                              }}
                            />
                          );
                        })()}
                      </div>
                      {response.data?.woNumber && (
                        <div className="mt-3 p-3 bg-blue-900/30 border border-blue-700 rounded">
                          <p className="text-sm text-gray-300">
                            <span className="font-semibold">Detected WO Number:</span>{" "}
                            <span className="font-mono text-blue-300">{response.data.woNumber}</span>
                          </p>
                        </div>
                      )}
                      {response.data?.jobExistsInSheet1 === false && (
                        <div className="mt-3 p-3 bg-red-900/30 border border-red-700 rounded">
                          <p className="text-sm text-red-300">
                            <span className="font-semibold">⚠️ Warning:</span> No matching job found in Sheet1 for work order "{response.data.woNumber}". 
                            Work orders can only be signed if they exist in the original job sheet. 
                            The work must exist before it can be marked as complete and ready for invoice.
                          </p>
                        </div>
                      )}
                      <button
                        onClick={() => handleOverride(fileId, response)}
                        disabled={overridingFileId === fileId || !response.data?.woNumber || response.data?.jobExistsInSheet1 === false}
                        className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                      >
                        {overridingFileId === fileId ? "Updating..." : "Update This One"}
                      </button>
                      {response.data?.jobExistsInSheet1 === false && (
                        <p className="mt-2 text-xs text-gray-400">
                          Add this work order to Sheet1 first, then you can sign it.
                        </p>
                      )}
                      {overrideErrors.has(fileId) && (
                        <div className="mt-3 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                          {overrideErrors.get(fileId)}
                        </div>
                      )}
                      {response.overrideSuccess && (
                        <div className="mt-3 p-3 bg-green-900/30 border border-green-700 rounded text-green-300 text-sm">
                          ✓ Successfully updated to SIGNED status
                        </div>
                      )}
                    </div>
                  )}

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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
