"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";

/**
 * Legacy /manual page - redirects to appropriate page based on auth status.
 * 
 * This page is deprecated. It redirects:
 * - Unauthenticated users → /free (public free tier)
 * - Authenticated users → /dashboard (Pro tier)
 * 
 * The /manual page previously had BYOK functionality which has been removed.
 * All file upload functionality is now in /free (public) and /dashboard (Pro).
 */
export default function ManualUploadPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        const response = await fetch("/api/auth/session");
        const session = await response.json();
        
        if (session && session.user) {
          // Authenticated user → redirect to dashboard
          router.replace("/dashboard");
        } else {
          // Unauthenticated user → redirect to free tier
          router.replace("/free");
        }
      } catch (error) {
        console.error("Error checking auth:", error);
        // On error, redirect to free tier (public)
        router.replace("/free");
      } finally {
        setIsChecking(false);
      }
    };

    checkAuthAndRedirect();
  }, [router]);

  // Show loading state while redirecting
  if (isChecking) {
    return (
      <AppShell>
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="text-center text-gray-400">Redirecting...</div>
        </div>
      </AppShell>
    );
  }

  return null;
}

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

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      // Check both MIME type and file extension as fallback
      const isValidPdf = file.type === "application/pdf" || 
                         file.type === "application/x-pdf" ||
                         file.name.toLowerCase().endsWith(".pdf");
      if (isValidPdf) {
        setSelectedFile(file);
      } else {
        alert("Please upload a PDF file");
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      // Check both MIME type and file extension as fallback
      const isValidPdf = file.type === "application/pdf" || 
                         file.type === "application/x-pdf" ||
                         file.name.toLowerCase().endsWith(".pdf");
      if (isValidPdf) {
        setSelectedFile(file);
      } else {
        alert("Please upload a PDF file");
      }
    }
  };

  const handleProcess = async () => {
    if (!selectedFile) {
      alert("Please select a PDF file");
      return;
    }

    // For FREE_BYOK plan, require OpenAI key
    if (requiresBYOK(plan) && !hasKey) {
      alert("Please enter your OpenAI API key before processing.");
      return;
    }

    setIsProcessing(true);

    try {
      // Process PDF directly with optional email text
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (emailText.trim()) {
        formData.append("emailText", emailText.trim());
      }

      // Set headers for plan
      const headers: HeadersInit = {
        "x-plan": plan,
      };
      
      // Free plan: Send BYOK in header (temporary - will move to client-side calls later)
      // IMPORTANT: BYOK is never stored server-side, only used for the request
      // Pro/Premium: Do NOT send any key (server uses env var)
      if (requiresBYOK(plan) && openaiKey) {
        headers["x-openai-key"] = openaiKey;
      }

      const processResponse = await fetch("/api/process-pdf", {
        method: "POST",
        headers,
        body: formData,
      });

      const contentType = processResponse.headers.get("content-type");

      // Handle non-2xx responses
      if (!processResponse.ok) {
        let message = "Failed to process PDF";

        if (contentType?.includes("application/json")) {
          try {
            const errorData = await processResponse.json();
            if (errorData?.error) {
              message = errorData.error;
            }
            // Handle duplicate file error (409 Conflict)
            if (processResponse.status === 409 && errorData.skippedAsDuplicate) {
              message = `This file has already been processed recently. ${errorData.error || "Please wait 24 hours or use a different file."}`;
            }
          } catch {
            // JSON parse failed, ignore and keep default message
          }
        } else {
          // If server sent back plain text or HTML, try to use that
          try {
            const text = await processResponse.text();
            if (text) message = text;
          } catch {
            // ignore
          }
        }

        throw new Error(message);
      }

      // If we get here, response is OK – parse success payload
      let processData: ManualProcessResponse;
      if (contentType?.includes("application/json")) {
        processData = await processResponse.json();
      } else {
        // If not JSON, try to parse as text (shouldn't happen, but handle gracefully)
        const text = await processResponse.text();
        throw new Error(`Unexpected response format: ${text.substring(0, 100)}`);
      }

      // Accumulate parsed work orders (with deduplication)
      const newWorkOrders = processData.workOrders || [];
      if (newWorkOrders.length > 0) {
        setAccumulatedWorkOrders((prev) => {
          const deduplicated = deduplicateWorkOrders(prev, newWorkOrders);
          const duplicatesSkipped = prev.length + newWorkOrders.length - deduplicated.length;
          if (duplicatesSkipped > 0) {
            console.log(`[Manual Upload] Skipped ${duplicatesSkipped} duplicate work order(s)`);
          }
          return deduplicated;
        });
      }

      // Update token usage in localStorage
      if (processData.meta.tokenUsage) {
        const stored = localStorage.getItem("tokenUsage");
        const current = stored ? JSON.parse(stored) : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        const updated = {
          promptTokens: current.promptTokens + processData.meta.tokenUsage.promptTokens,
          completionTokens: current.completionTokens + processData.meta.tokenUsage.completionTokens,
          totalTokens: current.totalTokens + processData.meta.tokenUsage.totalTokens,
        };
        localStorage.setItem("tokenUsage", JSON.stringify(updated));
        // Trigger storage event to update settings page if open
        window.dispatchEvent(new Event("storage"));
      }

      // Show success message
      const workOrderCount = newWorkOrders.length;
      const totalCount = accumulatedWorkOrders.length + newWorkOrders.length;
      const message = workOrderCount > 0
        ? `Successfully parsed ${workOrderCount} work order(s) from PDF. Total: ${totalCount} work order(s) in session.`
        : "PDF processed but no work orders were extracted.";

      alert(message);

      // Reset form for next upload (but keep accumulated work orders)
      setSelectedFile(null);
      setEmailText("");
    } catch (error) {
      console.error("Error processing work order:", error);
      alert(`Failed to process work order: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AppShell>
      <MainNavigation currentMode="file" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        {/* Page Title */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 mb-2">
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h1 className="text-2xl font-semibold text-white">
                Process Work Order from File
              </h1>
            </div>
            {/* Clean upgrade link for Free users */}
            <UpgradeButton />
          </div>
        </div>

        <div className="space-y-6">
          {/* BYOK Key Input (for FREE_BYOK plan) */}
          {requiresBYOK(plan) && <BYOKKeyInput />}

          {/* Upload PDF Section */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Upload PDF Work Order
              </h2>
              <button className="text-gray-400 hover:text-gray-300">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

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
                    : selectedFile
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
                  <p className="text-gray-300 mb-1">Drag and drop file here</p>
                  <p className="text-sm text-gray-400">Limit 200MB per file • PDF</p>
                </div>
                {selectedFile && (
                  <div className="mt-2 text-sm text-green-400">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}
              </div>
              <div className="absolute right-4 top-4">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf"
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
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email Text (Optional)
              </h2>
              <button className="text-gray-400 hover:text-gray-300">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <textarea
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste email text here (optional). This will be used along with the PDF to extract work order information."
              className="w-full h-32 px-4 py-3 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Process Button */}
          <div className="flex justify-end">
            <button
              onClick={handleProcess}
              disabled={!selectedFile || isProcessing || (requiresBYOK(plan) && !hasKey)}
              className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isProcessing ? "Processing..." : "Process Work Order"}
            </button>
          </div>

          {/* Parsed Work Orders Preview */}
          {accumulatedWorkOrders.length > 0 && (
            <ParsedWorkOrdersPreview
              workOrders={accumulatedWorkOrders}
              onClear={() => {
                setAccumulatedWorkOrders([]);
                setSelectedFile(null);
                setEmailText("");
              }}
              onRemove={(index) => {
                setAccumulatedWorkOrders((prev) => prev.filter((_, i) => i !== index));
              }}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

