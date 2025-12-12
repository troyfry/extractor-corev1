"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import ResultsTable from "@/components/work-orders/ResultsTable";
import type { WorkOrder } from "@/lib/workOrders/types";

/**
 * Pro tier dashboard page for work order extraction.
 * 
 * This page requires authentication and allows Pro users to upload PDFs
 * and extract work orders. Uses server-side OpenAI API key.
 * 
 * TODO Phase 2: Gmail inbox mode will plug in here.
 * TODO Phase 2: Template Profiles will eventually plug in.
 * TODO Phase 2: Vision fallback will be added.
 */
export default function DashboardPage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [emailText, setEmailText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/auth/session");
        const session = await response.json();
        if (session && session.user) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
          router.push("/auth/signin");
        }
      } catch (error) {
        console.error("Error checking auth:", error);
        setIsAuthenticated(false);
        router.push("/auth/signin");
      }
    };
    checkAuth();
  }, [router]);

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
      let allWorkOrders: WorkOrder[] = [];
      let totalExtracted = 0;
      const errors: string[] = [];

      // Process files sequentially
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        
        try {
          const formData = new FormData();
          formData.append("file", file);
          if (emailText.trim()) {
            formData.append("emailText", emailText.trim());
          }

          const response = await fetch("/api/extract-pro", {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            if (response.status === 401) {
              router.push("/auth/signin");
              return;
            }
            const errorData = await response.json().catch(() => ({ error: "Failed to process PDF" }));
            errors.push(`${file.name}: ${errorData.error || "Failed to process PDF"}`);
            continue;
          }

          const data = await response.json();
          const newWorkOrders = data.workOrders || [];
          if (newWorkOrders.length > 0) {
            allWorkOrders = [...allWorkOrders, ...newWorkOrders];
            totalExtracted++;
          }
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          errors.push(`${file.name}: ${errorMessage}`);
        }
      }

      // Update work orders state with all extracted work orders
      if (allWorkOrders.length > 0) {
        setWorkOrders(allWorkOrders);
      }

      // Show summary message
      if (errors.length > 0) {
        setError(errors.join("; "));
        if (totalExtracted > 0) {
          alert(`Processed ${totalExtracted} of ${selectedFiles.length} file(s). ${allWorkOrders.length} work order(s) extracted. Some errors occurred.`);
        } else {
          alert(`Failed to process files: ${errors.join("; ")}`);
        }
      } else if (totalExtracted > 0) {
        alert(`Successfully processed ${totalExtracted} file(s). Extracted ${allWorkOrders.length} work order(s)!`);
      } else {
        alert("Files processed but no work orders were extracted.");
      }

      // Reset form for next upload
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

  // Show loading state while checking auth
  if (isAuthenticated === null) {
    return (
      <AppShell>
        <div className="min-h-screen bg-gray-900 text-white pt-8 flex items-center justify-center">
          <div className="text-gray-400">Loading...</div>
        </div>
      </AppShell>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <AppShell>
      <MainNavigation currentMode="file" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">
              Pro Dashboard
            </h1>
            <p className="text-sm text-gray-400">
              Upload a PDF work order to extract structured data. Your work orders are saved to your account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
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

          {/* Results Table */}
          {workOrders.length > 0 && (
            <div className="mt-8">
              <ResultsTable rows={workOrders} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

