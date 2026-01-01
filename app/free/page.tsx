"use client";

import React, { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import ParsedWorkOrdersPreview from "@/components/manual/ParsedWorkOrdersPreview";
import type { ParsedWorkOrder, ManualProcessResponse } from "@/lib/workOrders/parsedTypes";
import { getAiHeaders } from "@/lib/byok-client";

/**
 * Free tier work order extraction page.
 * 
 * This page allows users to upload PDFs and extract work orders without authentication.
 * Uses server-side OpenAI key with rate limiting to protect server spend.
 * 
 * TODO Phase 2: Gmail inbox mode will plug in here.
 * TODO Phase 2: Template Profiles will eventually plug in.
 * TODO Phase 2: Vision fallback will be added.
 */
export default function FreePage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [emailText, setEmailText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [accumulatedWorkOrders, setAccumulatedWorkOrders] = useState<ParsedWorkOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  /**
   * Deduplicate work orders by work order number.
   * If duplicates exist, keep the one with more complete data (more non-null fields).
   */
  const deduplicateWorkOrders = (
    existing: ParsedWorkOrder[],
    newWorkOrders: ParsedWorkOrder[]
  ): ParsedWorkOrder[] => {
    // Create a map of existing work orders by work order number
    const existingMap = new Map<string, ParsedWorkOrder>();
    existing.forEach((wo) => {
      const key = wo.workOrderNumber.toLowerCase().trim();
      if (!existingMap.has(key)) {
        existingMap.set(key, wo);
      } else {
        // If duplicate exists, keep the one with more complete data
        const existingWo = existingMap.get(key)!;
        const existingScore = Object.values(existingWo).filter((v) => v !== null && v !== "").length;
        const newScore = Object.values(wo).filter((v) => v !== null && v !== "").length;
        if (newScore > existingScore) {
          existingMap.set(key, wo);
        }
      }
    });

    // Add new work orders, skipping duplicates
    newWorkOrders.forEach((wo) => {
      const key = wo.workOrderNumber.toLowerCase().trim();
      if (!existingMap.has(key)) {
        existingMap.set(key, wo);
      } else {
        // Check if new one has more complete data
        const existingWo = existingMap.get(key)!;
        const existingScore = Object.values(existingWo).filter((v) => v !== null && v !== "").length;
        const newScore = Object.values(wo).filter((v) => v !== null && v !== "").length;
        if (newScore > existingScore) {
          existingMap.set(key, wo);
        }
      }
    });

    return Array.from(existingMap.values());
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const validPdfs = files.filter(file => 
        file.type === "application/pdf" || 
        file.type === "application/x-pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
      );
      
      if (validPdfs.length > 0) {
        setSelectedFiles(prev => {
          // Combine with existing files, avoiding duplicates by name
          const existingNames = new Set(prev.map(f => f.name));
          const newFiles = validPdfs.filter(f => !existingNames.has(f.name));
          return [...prev, ...newFiles];
        });
      } else {
        alert("Please upload PDF files");
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const validPdfs = files.filter(file => 
        file.type === "application/pdf" || 
        file.type === "application/x-pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
      );
      
      if (validPdfs.length > 0) {
        setSelectedFiles(prev => {
          // Combine with existing files, avoiding duplicates by name
          const existingNames = new Set(prev.map(f => f.name));
          const newFiles = validPdfs.filter(f => !existingNames.has(f.name));
          return [...prev, ...newFiles];
        });
      } else {
        alert("Please upload PDF files");
      }
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (selectedFiles.length === 0) {
      alert("Please select at least one PDF file");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      let totalExtracted = 0;
      let totalWorkOrders = 0;
      const errors: string[] = [];

      // Process files sequentially to respect rate limits
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        
        try {
          const formData = new FormData();
          formData.append("file", file);
          if (emailText.trim()) {
            formData.append("emailText", emailText.trim());
          }

          const headers = getAiHeaders();
          
          const response = await fetch("/api/extract-free", {
            method: "POST",
            headers,
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Failed to process PDF" }));
            
            // Handle rate limit errors with specific messaging
            if (response.status === 429) {
              const message = errorData.message || errorData.error || "Free limit reached";
              setError(message);
              errors.push(`${file.name}: ${message}`);
              // Stop processing if rate limited
              break;
            }
            
            errors.push(`${file.name}: ${errorData.error || "Failed to process PDF"}`);
            continue;
          }

          const data: ManualProcessResponse = await response.json();
          
          // Accumulate parsed work orders (with deduplication)
          const newWorkOrders = data.workOrders || [];
          if (newWorkOrders.length > 0) {
            setAccumulatedWorkOrders((prev) => {
              const deduplicated = deduplicateWorkOrders(prev, newWorkOrders);
              const duplicatesSkipped = prev.length + newWorkOrders.length - deduplicated.length;
              if (duplicatesSkipped > 0) {
                console.log(`[Free Upload] Skipped ${duplicatesSkipped} duplicate work order(s) from ${file.name}`);
              }
              return deduplicated;
            });
            totalWorkOrders += newWorkOrders.length;
            totalExtracted++;
          }
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          errors.push(`${file.name}: ${errorMessage}`);
        }
      }

      // Show summary message
      if (errors.length > 0) {
        setError(errors.join("; "));
        if (totalExtracted > 0) {
          alert(`Processed ${totalExtracted} of ${selectedFiles.length} file(s). ${totalWorkOrders} work order(s) extracted. Some errors occurred.`);
        } else {
          alert(`Failed to process files: ${errors.join("; ")}`);
        }
      } else if (totalExtracted > 0) {
        alert(`Successfully processed ${totalExtracted} file(s). Extracted ${totalWorkOrders} work order(s).`);
      } else {
        alert("Files processed but no work orders were extracted.");
      }
      
      // Reset form for next upload (but keep accumulated work orders)
      setSelectedFiles([]);
      setEmailText("");
    } catch (error) {
      console.error("Error processing PDFs:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setError(errorMessage);
      alert(`Failed to process PDFs: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AppShell>
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">
              Free Work Order Extractor
            </h1>
            <p className="text-sm text-gray-400">
              Upload a PDF work order to extract structured data. No account or API key required.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Info Banner */}
            <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
              <p className="text-sm text-blue-200">
                <strong>Free Tier:</strong> No login required. Rate limited to 10 documents per day, 20 per month. 
                Create a <a href="/pricing" className="underline">Pro account</a> for unlimited access.
              </p>
            </div>

            {/* Upload PDF Section */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Upload PDF Work Order
              </h2>

              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`
                  relative border-2 border-dashed rounded-lg p-12 text-center transition-colors
                  ${
                    dragActive
                      ? "border-blue-500 bg-blue-900/20"
                      : selectedFiles.length > 0
                      ? "border-green-500 bg-green-900/20"
                      : "border-gray-600 bg-gray-700/50"
                  }
                `}
              >
                <div className="flex flex-col items-center gap-4">
                  <svg
                    className="w-12 h-12 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <div>
                    <p className="text-gray-300 mb-1">Drag and drop files here</p>
                    <p className="text-sm text-gray-400">Limit 200MB per file • PDF • Multiple files supported</p>
                  </div>
                  {selectedFiles.length > 0 && (
                    <div className="mt-4 w-full max-w-md">
                      <p className="text-sm text-gray-400 mb-2">Selected files ({selectedFiles.length}):</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {selectedFiles.map((file, index) => (
                          <div key={index} className="flex items-center justify-between bg-gray-700/50 rounded px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-green-400 truncate">{file.name}</p>
                              <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFile(index)}
                              className="ml-2 text-red-400 hover:text-red-300 text-sm font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="absolute right-4 top-4">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <span className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm font-medium">
                      Browse files
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Email Text Section (Optional) */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Email Text (Optional)
              </h2>
              <textarea
                value={emailText}
                onChange={(e) => setEmailText(e.target.value)}
                placeholder="Paste email text here (optional). This will be used along with the PDF to extract work order information."
                className="w-full h-32 px-4 py-3 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 text-red-200">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={selectedFiles.length === 0 || isProcessing}
                className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isProcessing 
                  ? `Processing ${selectedFiles.length} file(s)...` 
                  : `Extract Work Orders${selectedFiles.length > 0 ? ` (${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''})` : ''}`}
              </button>
            </div>
          </form>

          {/* Parsed Work Orders Preview */}
          {accumulatedWorkOrders.length > 0 && (
            <div className="mt-8">
              <ParsedWorkOrdersPreview
                workOrders={accumulatedWorkOrders}
                onClear={() => {
                  setAccumulatedWorkOrders([]);
                  setSelectedFiles([]);
                  setEmailText("");
                }}
                onRemove={(index) => {
                  setAccumulatedWorkOrders((prev) => prev.filter((_, i) => i !== index));
                }}
              />
            </div>
          )}

          {/* Privacy, Security & Fair Use Statement */}
          <div className="mt-12 pt-8 border-t border-gray-700">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              Privacy, Security & Fair Use Statement
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              The Free Work Order Extractor applies fair-use controls to maintain service quality. A one-way, non-reversible hash of your IP address is used solely to enforce usage limits (per-day, per-month, and global). No personal data, work orders, or uploaded files are stored or retained. All extraction is processed securely via our AI provider, and temporary technical logs are removed regularly. Continued use of this free service indicates your agreement to these fair-use practices.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

