"use client";

import React, { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import type { FmProfile } from "@/lib/templates/fmProfiles";

type FileInfo = {
  id: string;
  file: File;
  name: string;
  size: number;
};

// Reason copy mapping for human-readable explanations
const reasonCopy: Record<string, { title: string; body: string }> = {
  TEMPLATE_NOT_CONFIGURED: {
    title: "Capture zone not configured",
    body: "This facility sender doesn't have a saved capture zone yet. Set the rectangle once and it will work going forward.",
  },
  INVALID_CROP: {
    title: "Invalid capture zone",
    body: "The saved capture zone is out of bounds. Redraw the rectangle and save again.",
  },
  CROP_TOO_SMALL: {
    title: "Crop zone too small",
    body: "The rectangle is too small to reliably read the work order number. Make it bigger and save.",
  },
  PAGE_MISMATCH: {
    title: "Page mismatch",
    body: "This work order's number is on a different page than the saved capture zone. Update the capture zone page or redraw on the correct page.",
  },
  LOW_CONFIDENCE_AFTER_RETRY: {
    title: "Low confidence",
    body: "We tried a retry with a larger crop but it still wasn't confident. Add the WO number manually or adjust the crop zone.",
  },
  no_work_order_number: {
    title: "Work order number not detected",
    body: "Work order number not detected in the document. Check the snippet and enter it manually if visible.",
  },
  no_matching_job_row: {
    title: "WO not found in Sheet1",
    body: "The work order number was found, but no matching job exists in Sheet1. Add the job to Sheet1 first.",
  },
  update_failed: {
    title: "Could not update the matching job row — please verify",
    body: "The work order number was extracted but updating the sheet failed. Try again or verify manually.",
  },
  low_confidence: {
    title: "Document quality — please verify",
    body: "The document quality makes extraction uncertain. Review the snippet and verify the WO number or enter it manually.",
  },
};

/**
 * Suggest FM Key from email subject (front-end only, for convenience)
 */
function suggestFmKeyFromSubject(subject: string): string | null {
  const s = (subject || "").toLowerCase();

  // Keep this tiny + explicit (no magic)
  if (s.includes("23rd") || s.includes("23rdgroup")) return "23rdgroup";
  if (s.includes("superclean")) return "superclean";

  return null;
}

/**
 * Get likely FM from email subject (for display only, not auto-matching)
 */
function getLikelyFmFromSubject(subject: string): string | null {
  return suggestFmKeyFromSubject(subject);
}

/**
 * Map status values to user-friendly labels for display in badges/pills
 */
function getStatusLabel(status: string): string {
  switch (status) {
    case "UPDATED":
      return "✓ Updated";
    case "ALREADY_PROCESSED":
      return "✓ Already Processed";
    case "NEEDS_REVIEW":
      return "⚠ Verification";
    case "BLOCKED":
      return "⚠ Blocked";
    case "ERROR":
      return "✗ Error";
    default:
      return status;
  }
}

export default function SignedWorkOrdersPage() {
  const [fmKey, setFmKey] = useState("");
  const [fmProfiles, setFmProfiles] = useState<FmProfile[]>([]);
  const [isLoadingFmProfiles, setIsLoadingFmProfiles] = useState(true);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [responses, setResponses] = useState<Map<string, any>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [overridingFileId, setOverridingFileId] = useState<string | null>(null);
  const [overrideErrors, setOverrideErrors] = useState<Map<string, string>>(new Map());
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [showFixModal, setShowFixModal] = useState(false);
  const [selectedFixResponse, setSelectedFixResponse] = useState<{ fileId: string; response: any } | null>(null);
  const [gmailEmails, setGmailEmails] = useState<any[]>([]);
  const [isLoadingGmailEmails, setIsLoadingGmailEmails] = useState(false);
  const [gmailLabel, setGmailLabel] = useState<string>("signed_WOs");
  const [selectedGmailEmails, setSelectedGmailEmails] = useState<Set<string>>(new Set());
  const [gmailRunning, setGmailRunning] = useState(false);
  const [gmailSummary, setGmailSummary] = useState<any>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [expandedGmailResults, setExpandedGmailResults] = useState<Set<number>>(new Set());
  const [sourceMode, setSourceMode] = useState<"upload" | "gmail">("upload"); // Step 2: Source selection
  const [showMismatchModal, setShowMismatchModal] = useState(false);
  const [mismatchModalData, setMismatchModalData] = useState<{ selectedFm: string; detectedFm: string; emailSubject: string } | null>(null);

  // Load FM profiles on mount
  useEffect(() => {
    loadFmProfiles();
  }, []);

  async function loadFmProfiles() {
    setIsLoadingFmProfiles(true);
    try {
      const response = await fetch("/api/fm-profiles");
      if (response.ok) {
        const data = await response.json();
        const profiles = (data.profiles || []) as FmProfile[];
        setFmProfiles(profiles);
        console.log(`[Signed Page] Loaded ${profiles.length} FM profile(s)`);
      } else {
        console.error("[Signed Page] Failed to load FM profiles:", response.status);
      }
    } catch (err) {
      console.error("[Signed Page] Failed to load FM profiles:", err);
    } finally {
      setIsLoadingFmProfiles(false);
    }
  }

  // Clear all processing results when FM key changes
  // This ensures old results from wrong template don't persist
  useEffect(() => {
    setResponses(new Map());
    setError(null);
    setOverrideErrors(new Map());
    setExpandedResults(new Set());
  }, [fmKey]);

  // Reusable function to fetch Gmail emails
  const fetchGmailEmails = useCallback(async () => {
    // Use label name as-is (API handles spaces and case-insensitive matching)
    const labelToUse = gmailLabel.trim();
    console.log("[UI] Fetching Gmail emails with label:", labelToUse || "(none - will use INBOX)");
    setIsLoadingGmailEmails(true);
    setGmailError(null);
    setGmailEmails([]); // Clear previous results
    try {
      const url = new URL("/api/gmail/list", window.location.origin);
      if (labelToUse) {
        url.searchParams.set("label", labelToUse);
      }
      console.log("[UI] Fetching from:", url.toString());
      const response = await fetch(url.toString());
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch emails" }));
        const errorMessage = errorData.error || "Failed to fetch emails";
        console.error("[UI] Gmail fetch failed:", errorMessage);
        throw new Error(errorMessage);
      }
      const data = await response.json();
      console.log("[UI] Gmail fetch successful, received", data.emails?.length || 0, "emails with PDF attachments");
      
      if (data.emails?.length === 0) {
        const searchInfo = labelToUse 
          ? `No emails with PDF attachments found in label "${labelToUse}".\n\nCheck:\n- The label exists in your Gmail\n- The label contains emails with PDF attachments\n- Check browser console (F12) for detailed debug logs`
          : `No emails found in INBOX with PDF attachments.`;
        setGmailError(searchInfo);
      } else {
        // Clear any previous errors if we got results
        setGmailError(null);
      }
      
      setGmailEmails(data.emails || []);
      setSelectedGmailEmails(new Set());
    } catch (err) {
      console.error("[UI] Gmail fetch error:", err);
      setGmailError(err instanceof Error ? err.message : "Failed to fetch emails");
      setGmailEmails([]);
    } finally {
      setIsLoadingGmailEmails(false);
    }
  }, [gmailLabel]);

  // Removed auto-trigger - emails only load when button is clicked

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
      // ALREADY_PROCESSED is not an error - it's a valid response (status 200)
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

  type SignedProcessResponse = {
    mode: "UPDATED" | "NEEDS_REVIEW" | "ALREADY_PROCESSED";
    data?: {
      woNumber?: string | null;
      signedPdfUrl?: string | null;
      snippetDriveUrl?: string | null;
      snippetImageUrl?: string | null;
      fileHash?: string;
      foundIn?: "WORK_ORDERS" | "NEEDS_REVIEW_SIGNED";
      rowIndex?: number;
      [key: string]: unknown;
    };
    overrideSuccess?: boolean;
  };

  async function handleOverride(fileId: string, response: SignedProcessResponse) {
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
              Match signed work orders to existing jobs and mark them complete.
            </p>
    </div>

          <div className="space-y-6">
            {/* Step 1: FM Key Selection - Always Visible */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Step 1 — Select Facility Manager (FM)
              </h2>
                <div>
                  {isLoadingFmProfiles ? (
                    <div className="text-gray-400">Loading facility senders...</div>
                  ) : fmProfiles.length === 0 ? (
                    <div className="text-yellow-400">
                      No facility senders found. Please add FM profiles first.
                    </div>
                  ) : (
                    <select
                      value={fmKey}
                      onChange={(e) => setFmKey(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select FM Key --</option>
                      {fmProfiles.map((profile) => (
                        <option key={profile.fmKey} value={profile.fmKey}>
                          {profile.fmLabel || profile.fmKey}
                        </option>
                      ))}
                    </select>
                  )}
                {fmKey && (
                  <p className="mt-2 text-sm text-gray-300">
                    You are processing signed work orders for this FM only.
                  </p>
                )}
              </div>
                </div>

            {/* Step 2: Source Selection */}
            {fmKey && (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                  Step 2 — How do you want to import signed PDFs?
                </h2>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="source"
                      value="upload"
                      checked={sourceMode === "upload"}
                      onChange={() => setSourceMode("upload")}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-300">Upload PDF files</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="source"
                      value="gmail"
                      checked={sourceMode === "gmail"}
                      onChange={() => setSourceMode("gmail")}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-300">Get from Gmail</span>
                  </label>
                </div>
              </div>
            )}

            {/* Upload Section */}
            {fmKey && sourceMode === "upload" && (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Upload Signed PDFs
                  </label>
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    onChange={handleFileUpload}
                      disabled={!fmKey}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    You can upload multiple PDF files at once (one work order per PDF)
                  </p>
                </div>

                  {error && (
                    <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                      {error}
                    </div>
                  )}
                </div>
              </div>
            )}


            {/* Gmail Section */}
            {fmKey && sourceMode === "gmail" && (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <div className="space-y-4">
                  {/* FM Confirmation Banner */}
                  <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded">
                    <p className="text-sm text-yellow-200">
                      🟡 Processing Gmail for FM: <strong>{fmKey}</strong>
                    </p>
                    <p className="text-xs text-yellow-200/80 mt-1">
                      Only emails containing signed work orders for this FM should be selected.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-300 whitespace-nowrap">Gmail Label:</label>
                      <input
                        type="text"
                        value={gmailLabel}
                        onChange={(e) => setGmailLabel(e.target.value)}
                        placeholder="e.g., signed_WOs, INBOX"
                        disabled={!fmKey}
                        className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      {gmailLabel && (
                        <button
                          onClick={() => setGmailLabel("")}
                          className="px-2 py-1.5 text-gray-400 hover:text-gray-300 text-sm"
                          title="Clear"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <button
                      onClick={fetchGmailEmails}
                      disabled={isLoadingGmailEmails || !fmKey}
                      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors font-medium"
                    >
                      {isLoadingGmailEmails ? "Loading..." : "Load Signed PDFs for Selected FM"}
                    </button>
                    <p className="text-xs text-gray-400">
                      Only select emails that belong to <strong>{fmKey}</strong>
                    </p>
                  </div>
                  <div className="p-2 bg-gray-900/50 rounded border border-gray-700">
                    <p className="text-xs text-gray-400 mb-1">
                      <strong>Search Criteria:</strong> Emails with PDF attachments in label "{gmailLabel || 'INBOX'}"
                    </p>
                    <p className="text-xs text-gray-500 mb-1">
                      <strong>Note:</strong> Subject line does NOT matter. Emails with any subject (e.g., "paperwork", "signed docs", etc.) will be included as long as they have PDF attachments.
                  </p>
                    <p className="text-xs text-gray-500">
                      Label names are case-sensitive. Make sure the label exists in your Gmail and contains emails with PDF attachments.
                    </p>
              </div>

              {gmailError && (
                <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                  Gmail Error: {gmailError}
                </div>
              )}

              {/* Gmail Email List */}
              {gmailEmails.length > 0 && (
                <div className="mt-6 bg-gray-800 rounded-lg p-6 border border-gray-700">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-white">
                        Gmail Emails ({gmailEmails.length})
                      </h3>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            const emailsWithPdfs = gmailEmails.filter(e => e.attachmentCount > 0);
                            if (selectedGmailEmails.size === emailsWithPdfs.length) {
                              setSelectedGmailEmails(new Set());
                            } else {
                              setSelectedGmailEmails(new Set(emailsWithPdfs.map(e => e.id)));
                            }
                          }}
                          className="px-3 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm font-medium"
                        >
                          {selectedGmailEmails.size === gmailEmails.filter(e => e.attachmentCount > 0).length
                            ? "Deselect All"
                            : "Select All"}
                        </button>
                        {selectedGmailEmails.size > 0 && (
                          <button
                            onClick={async () => {
                              if (!fmKey) {
                                setGmailError("Please select an FM Key first");
                                return;
                              }
                              
                              // Check for FM mismatches
                              const selectedEmails = gmailEmails.filter(e => selectedGmailEmails.has(e.id));
                              const mismatchedEmails = selectedEmails.filter(email => {
                                const likelyFm = getLikelyFmFromSubject(email.subject || "");
                                return likelyFm && likelyFm !== fmKey;
                              });
                              
                              if (mismatchedEmails.length > 0) {
                                const firstMismatch = mismatchedEmails[0];
                                const likelyFm = getLikelyFmFromSubject(firstMismatch.subject || "");
                                setMismatchModalData({
                                  selectedFm: fmKey,
                                  detectedFm: likelyFm || "unknown",
                                  emailSubject: firstMismatch.subject || "",
                                });
                                setShowMismatchModal(true);
                                return;
                              }
                              
                              setGmailRunning(true);
                              setGmailError(null);
                              setGmailSummary(null);
                              try {
                                const res = await fetch("/api/signed/gmail/process", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    fmKey,
                                    messageIds: Array.from(selectedGmailEmails),
                                  }),
                                });
                                if (!res.ok) {
                                  const errorData = await res.json().catch(() => ({ error: "Failed to process" }));
                                  throw new Error(errorData.error || "Failed to process Gmail attachments");
                                }
                                const data = await res.json();
                                setGmailSummary({
                                  ok: true,
                                  fmKey,
                                  queryUsed: `Selected ${selectedGmailEmails.size} messages`,
                                  scannedMessages: selectedEmails.length,
                                  scannedAttachments: data.items?.length || 0,
                                  results: data.results || {
                                    updated: 0,
                                    needsReview: 0,
                                    blocked: 0,
                                    alreadyProcessed: 0,
                                    errors: 0,
                                  },
                                  items: data.items || [],
                                });
                                // Clear selection after processing
                                setSelectedGmailEmails(new Set());
                              } catch (err) {
                                setGmailError(err instanceof Error ? err.message : "An error occurred");
                              } finally {
                                setGmailRunning(false);
                              }
                            }}
                            disabled={gmailRunning || !fmKey || selectedGmailEmails.size === 0}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                          >
                            {gmailRunning
                              ? `Processing ${selectedGmailEmails.size}...`
                              : `Process Selected (${selectedGmailEmails.size})`}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700">
                          <tr>
                            <th className="px-2 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-10">
                              <input
                                type="checkbox"
                                checked={
                                  gmailEmails.filter(e => e.attachmentCount > 0).length > 0 &&
                                  selectedGmailEmails.size === gmailEmails.filter(e => e.attachmentCount > 0).length
                                }
                                onChange={() => {
                                  const emailsWithPdfs = gmailEmails.filter(e => e.attachmentCount > 0);
                                  if (selectedGmailEmails.size === emailsWithPdfs.length) {
                                    setSelectedGmailEmails(new Set());
                                  } else {
                                    setSelectedGmailEmails(new Set(emailsWithPdfs.map(e => e.id)));
                                  }
                                }}
                                className="rounded border-gray-600 text-blue-600 focus:ring-blue-500"
                              />
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider min-w-[250px]">
                              Subject
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-28">
                              Date
                            </th>
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider w-20">
                              PDFs
                            </th>
                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider min-w-[120px]">
                              Likely FM
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                          {gmailEmails.map((email) => {
                            const likelyFm = getLikelyFmFromSubject(email.subject || "");
                            const isMismatch = likelyFm && likelyFm !== fmKey;
                            const isDisabled = email.attachmentCount === 0 || isMismatch;
                            
                            return (
                            <tr
                              key={email.id}
                              className={`hover:bg-gray-750 ${
                                selectedGmailEmails.has(email.id) ? "bg-gray-700/50" : ""
                                } ${isMismatch ? "opacity-60" : ""}`}
                            >
                              <td className="px-2 py-3">
                                <input
                                  type="checkbox"
                                  checked={selectedGmailEmails.has(email.id)}
                                  onChange={() => {
                                    const next = new Set(selectedGmailEmails);
                                    if (next.has(email.id)) {
                                      next.delete(email.id);
                                    } else {
                                      next.add(email.id);
                                    }
                                    setSelectedGmailEmails(next);
                                  }}
                                    disabled={isDisabled}
                                  className="rounded border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-30"
                                    title={isMismatch ? `This email appears to belong to FM '${likelyFm}'. Switch FM Key to process.` : undefined}
                                />
                              </td>
                                <td className="px-3 py-3 text-sm font-medium text-white">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate">{email.subject || "(No subject)"}</span>
                                  </div>
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-400">
                                {email.date ? new Date(email.date).toLocaleDateString() : ""}
                              </td>
                              <td className="px-3 py-3 text-center">
                                {email.attachmentCount > 0 ? (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/50 text-green-300">
                                    {email.attachmentCount}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-400">
                                    0
                                  </span>
                                )}
                              </td>
                                <td className="px-3 py-3">
                                  {likelyFm ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-900/50 text-blue-300">
                                      Likely: {likelyFm}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-400">
                                      Unknown FM
                                    </span>
                                  )}
                                </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}


                  {gmailSummary && gmailSummary.items && gmailSummary.items.length > 0 && (
                    <div className="mt-6 space-y-4">
                      <h2 className="text-xl font-semibold text-white">Gmail Processing Results</h2>
                      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-4">
                        <div className="flex gap-2 flex-wrap">
                          <p className="text-sm text-gray-300">Query: <span className="font-mono text-xs">{gmailSummary.queryUsed}</span></p>
                          <p className="text-sm text-gray-300">Scanned: {gmailSummary.scannedMessages} messages, {gmailSummary.scannedAttachments} attachments</p>
                      {gmailSummary.results.updated > 0 && (
                        <span className="px-2 py-1 bg-green-900 text-green-300 rounded text-xs">
                          ✓ {gmailSummary.results.updated} Updated
                        </span>
                      )}
                      {gmailSummary.results.alreadyProcessed > 0 && (
                        <span className="px-2 py-1 bg-blue-900 text-blue-300 rounded text-xs">
                          ✓ {gmailSummary.results.alreadyProcessed} Already Processed
                        </span>
                      )}
                      {gmailSummary.results.needsReview > 0 && (
                        <span className="px-2 py-1 bg-yellow-900 text-yellow-300 rounded text-xs">
                          ⚠ {gmailSummary.results.needsReview} Verification
                        </span>
                      )}
                      {gmailSummary.results.blocked > 0 && (
                        <span className="px-2 py-1 bg-orange-900 text-orange-300 rounded text-xs">
                          🚫 {gmailSummary.results.blocked} Blocked
                        </span>
                      )}
                      {gmailSummary.results.errors > 0 && (
                        <span className="px-2 py-1 bg-red-900 text-red-300 rounded text-xs">
                          ✗ {gmailSummary.results.errors} Errors
                        </span>
                      )}
                    </div>
                      </div>
                      
                      <div className="space-y-2">
                    {gmailSummary.items.map((item: any, idx: number) => {
                      const isExpanded = expandedGmailResults.has(idx);
                      return (
                        <div key={idx} className="bg-gray-800 rounded-lg border border-gray-700">
                          <button
                            onClick={() => {
                              setExpandedGmailResults((prev) => {
                                const next = new Set(prev);
                                if (next.has(idx)) {
                                  next.delete(idx);
                                } else {
                                  next.add(idx);
                                }
                                return next;
                              });
                            }}
                            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-750 transition-colors"
                          >
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              <svg
                                className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${
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
                              <span className="font-mono text-sm text-gray-300 truncate flex-1">{item.filename}</span>
                              <span className={`px-3 py-1 rounded text-xs font-medium flex-shrink-0 ${
                                  item.status === "UPDATED" ? "bg-green-900 text-green-300" :
                                  item.status === "ALREADY_PROCESSED" ? "bg-blue-900 text-blue-300" :
                                  item.status === "NEEDS_REVIEW" ? "bg-yellow-900 text-yellow-300" :
                                  item.status === "BLOCKED" ? "bg-orange-900 text-orange-300" :
                                  "bg-red-900 text-red-300"
                                }`}>
                                  {getStatusLabel(item.status)}
                                </span>
                              {item.woNumber && (
                                <span className="text-sm text-gray-400 font-mono flex-shrink-0">
                                  WO: {item.woNumber}
                                </span>
                              )}
                            </div>
                          </button>
                          
                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-3">
                              {/* Verification / Blocked Section */}
                              {(item.status === "NEEDS_REVIEW" || item.status === "BLOCKED") && (
                                <div className="space-y-4">
                                  {/* Reason Explanation */}
                                  {(item.reasonTitle || item.reason) && (
                                    <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded">
                                      <h4 className="text-md font-semibold text-yellow-300 mb-2">
                                        {item.reasonTitle || "Verification"}
                                      </h4>
                                      <p className="text-sm text-yellow-200/80">
                                        {item.reasonMessage || 
                                         (item.reason ? reasonCopy[item.reason]?.body : null) ||
                                         "This work order requires verification."}
                                      </p>
                                    </div>
                                  )}

                                  {/* Verify Button */}
                                  {item.fixHref && (
                                    <button
                                      onClick={() => {
                                        setSelectedFixResponse({ 
                                          fileId: `gmail-${item.messageId}-${idx}`, 
                                          response: { 
                                            mode: item.status === "BLOCKED" ? "NEEDS_REVIEW" : "NEEDS_REVIEW",
                                            data: {
                                              fixHref: item.fixHref,
                                              fixAction: item.fixAction,
                                              reasonTitle: item.reasonTitle,
                                              reasonMessage: item.reasonMessage,
                                              fmKey: item.fmKey,
                                              woNumber: item.woNumber,
                                              snippetImageUrl: item.snippetImageUrl,
                                              snippetDriveUrl: item.snippetDriveUrl,
                                              reason: item.reason,
                                            }
                                          } 
                                        });
                                        setShowFixModal(true);
                                      }}
                                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
                                    >
                                      {item.fixAction || "Verify"}
                                    </button>
                              )}

                                  {/* Snippet Image - Show if available */}
                                  {(item.snippetImageUrl || item.snippetDriveUrl) && (
                                    <div className="mt-4 p-4 bg-gray-900 rounded border border-gray-700">
                                      <h4 className="text-md font-semibold text-white mb-4">Work Order Snippet</h4>
                                      <p className="text-sm text-gray-400 mb-3">
                                        Review the snippet below to verify the work order number. If it's clear, click "Update This One" to manually override.
                                      </p>
                                      <div className="bg-gray-950 rounded border border-gray-800 p-2">
                                        {(() => {
                                          // Prefer Drive URL, but fall back to base64 if Drive upload failed
                                          const snippetDriveUrl = item.snippetDriveUrl;
                                          const snippetImageUrl = item.snippetImageUrl;
                                          
                                          // Determine the best URL to use
                                          let directImageUrl: string | null = null;
                                          let sourceType: "drive" | "base64" | null = null;
                                          
                                          // Try Drive URL first if available
                                          if (snippetDriveUrl) {
                                            // Handle base64 data URLs (shouldn't happen for Drive URL, but check anyway)
                                            if (snippetDriveUrl.startsWith("data:image")) {
                                              directImageUrl = snippetDriveUrl;
                                              sourceType = "base64";
                                          }
                                          // Handle Google Drive URLs - convert to direct image link
                                            else if (snippetDriveUrl.includes("drive.google.com")) {
                                            // Try to extract file ID from various Google Drive URL formats
                                              const fileIdMatch = snippetDriveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                                                                snippetDriveUrl.match(/id=([a-zA-Z0-9_-]+)/) ||
                                                                snippetDriveUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                                              
                                            if (fileIdMatch) {
                                              const fileId = fileIdMatch[1];
                                                // Try multiple Drive image URL formats for better compatibility
                                                // Format 1: Thumbnail API (requires public access)
                                                // Format 2: Direct file access (if publicly shared)
                                                // Format 3: Use webContentLink if available (from upload response)
                                                // For now, try thumbnail first, fallback to base64 on error
                                              directImageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
                                                sourceType = "drive";
                                              } else {
                                                // Drive URL format not recognized, fall back to base64 if available
                                                console.warn("Could not extract file ID from Drive URL:", snippetDriveUrl);
                                                if (snippetImageUrl && snippetImageUrl.startsWith("data:image")) {
                                                  directImageUrl = snippetImageUrl;
                                                  sourceType = "base64";
                                                }
                                              }
                                            } else if (snippetDriveUrl.startsWith("http")) {
                                              // Not a Drive URL, use as-is (might be a direct image URL or webContentLink)
                                              directImageUrl = snippetDriveUrl;
                                              sourceType = "drive";
                                            } else {
                                              // Invalid URL format, fall back to base64
                                              console.warn("Invalid snippet URL format:", snippetDriveUrl);
                                              if (snippetImageUrl && snippetImageUrl.startsWith("data:image")) {
                                                directImageUrl = snippetImageUrl;
                                                sourceType = "base64";
                                              }
                                            }
                                          }
                                          
                                          // Fall back to base64 if Drive URL wasn't available or failed
                                          if (!directImageUrl && snippetImageUrl && snippetImageUrl.startsWith("data:image")) {
                                            directImageUrl = snippetImageUrl;
                                            sourceType = "base64";
                                          }
                                          
                                          if (!directImageUrl) {
                                            return (
                                              <p className="text-gray-500 text-sm p-4 text-center">
                                                No snippet image available
                                              </p>
                                            );
                                          }
                                          
                                          return (
                                            <img
                                              src={directImageUrl}
                                              alt="Work order snippet"
                                              className="max-w-full h-auto rounded object-contain mx-auto block"
                                              style={{ maxHeight: "200px", maxWidth: "300px" }}
                                              onError={(e) => {
                                                const errorInfo = {
                                                  driveUrl: snippetDriveUrl || null,
                                                  base64Url: snippetImageUrl ? (snippetImageUrl.substring(0, 50) + "...") : null,
                                                  attemptedUrl: directImageUrl || null,
                                                  sourceType: sourceType || null,
                                                  hasDriveUrl: !!snippetDriveUrl,
                                                  hasBase64Url: !!snippetImageUrl,
                                                  driveUrlLength: snippetDriveUrl?.length || 0,
                                                  base64UrlLength: snippetImageUrl?.length || 0,
                                                };
                                                console.error("Failed to load snippet image:", errorInfo);
                                                
                                                // If we tried Drive URL and it failed, try base64 fallback
                                                if (sourceType === "drive" && snippetImageUrl && snippetImageUrl.startsWith("data:image")) {
                                                  console.log("Trying base64 fallback URL");
                                                  e.currentTarget.src = snippetImageUrl;
                                                  return;
                                                }
                                                
                                                // Try original Drive URL as last resort (if we converted it)
                                                if (sourceType === "drive" && snippetDriveUrl && e.currentTarget.src !== snippetDriveUrl) {
                                                  console.log("Trying original Drive URL");
                                                  e.currentTarget.src = snippetDriveUrl;
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
                                                  url: directImageUrl?.substring(0, 100),
                                                  source: sourceType,
                                                });
                                              }}
                                            />
                                          );
                                        })()}
                            </div>
                        </div>
                                  )}
                      </div>
                              )}

                              {/* Basic Info */}
                              <div className="text-sm text-gray-300">
                                <p><strong>Filename:</strong> <span className="font-mono">{item.filename}</span></p>
                                {item.messageId && (
                                  <p className="mt-1"><strong>Message ID:</strong> <span className="font-mono text-xs">{item.messageId}</span></p>
                                )}
                                {item.woNumber && (
                                  <p className="mt-1"><strong>Work Order:</strong> <span className="font-mono">{item.woNumber}</span></p>
                                )}
                                {item.reason && !item.reasonTitle && (
                                  <p className="mt-1"><strong>Reason:</strong> <span className="text-yellow-300">{item.reason}</span></p>
                                )}
                                {item.fileHash && (
                                  <p className="mt-1"><strong>File Hash:</strong> <span className="font-mono text-xs">{item.fileHash.substring(0, 16)}...</span></p>
                                )}
                                {item.signedPdfUrl && (
                                  <p className="mt-1">
                                    <strong>PDF:</strong>{" "}
                                    <a href={item.signedPdfUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                                      View PDF
                                    </a>
                                  </p>
                    )}
                  </div>
                </div>
              )}
            </div>
                      );
                      })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

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
                      {Array.from(responses.values()).filter(r => r.mode === "ALREADY_PROCESSED").length > 0 && (
                        <span className="px-2 py-1 bg-blue-900 text-blue-300 rounded text-xs">
                          ✓ {Array.from(responses.values()).filter(r => r.mode === "ALREADY_PROCESSED").length} Already Processed
                        </span>
                      )}
                      {Array.from(responses.values()).filter(r => r.mode === "NEEDS_REVIEW").length > 0 && (
                        <span className="px-2 py-1 bg-yellow-900 text-yellow-300 rounded text-xs">
                          ⚠ {Array.from(responses.values()).filter(r => r.mode === "NEEDS_REVIEW").length} Verification
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
                                      : response.mode === "ALREADY_PROCESSED"
                                      ? "bg-blue-900 text-blue-300"
                                      : "bg-yellow-900 text-yellow-300"
                                  }`}
                                >
                                  {response.mode === "UPDATED" 
                                    ? "✓ Updated" 
                                    : response.mode === "ALREADY_PROCESSED"
                                    ? "✓ Already Processed"
                                    : "⚠ Review"}
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
                              : response.mode === "ALREADY_PROCESSED"
                              ? "bg-blue-900 text-blue-300"
                              : "bg-yellow-900 text-yellow-300"
                          }`}
                        >
                          {response.mode === "UPDATED" 
                            ? "✓ Updated" 
                            : response.mode === "ALREADY_PROCESSED"
                            ? "✓ Already Processed"
                            : "⚠ Verification"}
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
                        {/* Already Processed Section */}
                        {response.mode === "ALREADY_PROCESSED" && (
                          <div className="p-4 bg-blue-900/20 border border-blue-700 rounded">
                            <h4 className="text-md font-semibold text-blue-300 mb-2">
                              Already Processed
                            </h4>
                            <p className="text-sm text-blue-200/80 mb-3">
                              This PDF was already processed and found in {response.data?.foundIn === "WORK_ORDERS" ? "Work_Orders" : "Verification"}.
                            </p>
                            {response.data?.rowIndex && (
                              <div className="text-sm text-blue-200/80">
                                <p>Row Index: <span className="font-mono">{response.data.rowIndex}</span></p>
                                {response.data?.foundIn && (
                                  <p className="mt-1">
                                    Sheet: <span className="font-mono">{response.data.foundIn === "WORK_ORDERS" ? "Work_Orders" : "Verification"}</span>
                                  </p>
                                )}
                              </div>
                            )}
                            {response.data?.fileHash && (
                              <p className="text-xs text-blue-300/60 mt-2 font-mono">
                                Hash: {response.data.fileHash.substring(0, 16)}...
                              </p>
                            )}
                          </div>
                        )}

                        {/* Verification Section */}
                        {response.mode === "NEEDS_REVIEW" && (
                          <div className="space-y-4">
                            {/* Reason Explanation */}
                            {(response.data?.reasonTitle || response.data?.reason) && (
                              <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded">
                                <h4 className="text-md font-semibold text-yellow-300 mb-2">
                                  {response.data?.reasonTitle || "Verification"}
                                </h4>
                                <p className="text-sm text-yellow-200/80">
                                  {response.data?.reasonMessage || 
                                   (response.data?.reason ? reasonCopy[response.data.reason]?.body : null) ||
                                   "This work order requires manual review."}
                                </p>
                              </div>
                            )}

                            {/* Verify Button */}
                            {response.data?.fixHref && (
                              <button
                                onClick={() => {
                                  setSelectedFixResponse({ fileId, response });
                                  setShowFixModal(true);
                                }}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
                              >
                                {response.data.fixAction || "Verify"}
                              </button>
                            )}

                            {/* Snippet Image - Show if available */}
                            {(response.data?.snippetImageUrl || response.data?.snippetDriveUrl) && (
                              <div className="mt-4 p-4 bg-gray-900 rounded border border-gray-700">
                                <h4 className="text-md font-semibold text-white mb-4">Work Order Snippet</h4>
                                <p className="text-sm text-gray-400 mb-3">
                                  Review the snippet below to verify the work order number. If it's clear, click "Update This One" to manually override.
                                </p>
                                <div className="bg-gray-950 rounded border border-gray-800 p-2">
                        {(() => {
                          // Prefer Drive URL, but fall back to base64 if Drive upload failed
                          const snippetDriveUrl = response.data.snippetDriveUrl;
                          const snippetImageUrl = response.data.snippetImageUrl;
                          
                          // Determine the best URL to use
                          let directImageUrl: string | null = null;
                          let sourceType: "drive" | "base64" | null = null;
                          
                          // Try Drive URL first if available
                          if (snippetDriveUrl) {
                            // Handle base64 data URLs (shouldn't happen for Drive URL, but check anyway)
                            if (snippetDriveUrl.startsWith("data:image")) {
                              directImageUrl = snippetDriveUrl;
                              sourceType = "base64";
                          }
                          // Handle Google Drive URLs - convert to direct image link
                            else if (snippetDriveUrl.includes("drive.google.com")) {
                            // Try to extract file ID from various Google Drive URL formats
                              const fileIdMatch = snippetDriveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                                                snippetDriveUrl.match(/id=([a-zA-Z0-9_-]+)/) ||
                                                snippetDriveUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                            
                            if (fileIdMatch) {
                              const fileId = fileIdMatch[1];
                              // Use the thumbnail format which is more reliable for public images
                              directImageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
                                sourceType = "drive";
                              } else {
                                // Drive URL format not recognized, fall back to base64 if available
                                console.warn("Could not extract file ID from Drive URL:", snippetDriveUrl);
                                if (snippetImageUrl && snippetImageUrl.startsWith("data:image")) {
                                  directImageUrl = snippetImageUrl;
                                  sourceType = "base64";
                                }
                              }
                            } else {
                              // Not a Drive URL, use as-is (might be a direct image URL)
                              directImageUrl = snippetDriveUrl;
                              sourceType = "drive";
                            }
                          }
                          
                          // Fall back to base64 if Drive URL wasn't available or failed
                          if (!directImageUrl && snippetImageUrl && snippetImageUrl.startsWith("data:image")) {
                            directImageUrl = snippetImageUrl;
                            sourceType = "base64";
                          }
                          
                          if (!directImageUrl) {
                            return (
                              <p className="text-gray-500 text-sm p-4 text-center">
                                No snippet image available
                              </p>
                            );
                          }
                          
                          return (
                            <img
                              src={directImageUrl}
                              alt="Work order snippet"
                              className="max-w-full h-auto rounded object-contain mx-auto block"
                              style={{ maxHeight: "200px", maxWidth: "300px" }}
                              onError={(e) => {
                                console.error("Failed to load snippet image:", {
                                  driveUrl: snippetDriveUrl,
                                  base64Url: snippetImageUrl ? (snippetImageUrl.substring(0, 50) + "...") : null,
                                  attemptedUrl: directImageUrl,
                                  sourceType,
                                  woNumber: response.data?.woNumber,
                                });
                                
                                // If we tried Drive URL and it failed, try base64 fallback
                                if (sourceType === "drive" && snippetImageUrl && snippetImageUrl.startsWith("data:image")) {
                                  console.log("Trying base64 fallback URL");
                                  e.currentTarget.src = snippetImageUrl;
                                  return;
                                }
                                
                                // Try original Drive URL as last resort (if we converted it)
                                if (sourceType === "drive" && snippetDriveUrl && e.currentTarget.src !== snippetDriveUrl) {
                                  console.log("Trying original Drive URL");
                                  e.currentTarget.src = snippetDriveUrl;
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
                                  url: directImageUrl?.substring(0, 100),
                                  source: sourceType,
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
                                {response.data?.jobExistsInSheet1 === false && (
                                  <p className="mt-2 text-xs text-gray-400">
                                    Add this work order to Sheet1 first, then you can sign it.
                                  </p>
                                )}
                                <button
                                  onClick={() => handleOverride(fileId, response)}
                                  disabled={overridingFileId === fileId || !response.data?.woNumber || response.data?.jobExistsInSheet1 === false}
                                  className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                                >
                                  {overridingFileId === fileId ? "Updating..." : "Update This One"}
                                </button>
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
                          </div>
                        )}

                  {response.data && (
                    <div className="mt-6 space-y-4">
                      {/* Template / Pages Debug Section */}
                      <div className="p-4 bg-gray-900 rounded border border-gray-700">
                        <h4 className="text-md font-semibold text-white mb-3">Template / Pages</h4>
                        <div className="space-y-2 text-sm text-gray-300">
                          <p>
                            <span className="font-semibold">Template Used:</span>{" "}
                            {response.data.templateUsed?.templateId ? (
                              <span className="font-mono text-blue-300">{response.data.templateUsed.templateId}</span>
                            ) : (
                              <span className="text-gray-500">None</span>
                            )}
                          </p>
                          <p>
                            <span className="font-semibold">Template Page:</span>{" "}
                            {response.data.templateUsed?.page ?? response.data.templateId ? (
                              response.data.templateUsed?.page ?? "—"
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </p>
                          <p>
                            <span className="font-semibold">Attempted Pages:</span>{" "}
                            {response.data.attemptedPages || <span className="text-gray-500">—</span>}
                          </p>
                          <p>
                            <span className="font-semibold">Chosen Page:</span>{" "}
                            {response.data.chosenPage ?? <span className="text-gray-500">—</span>}
                          </p>
                        </div>
                      </div>

                      {/* OCR Confidence Section */}
                      <div className="p-4 bg-gray-900 rounded border border-gray-700">
                        <h4 className="text-md font-semibold text-white mb-4">OCR Confidence</h4>
                        <div className="space-y-3">
                          <div>
                            <span className="text-sm text-gray-400">OCR Confidence: </span>
                            <span
                              className={`font-bold uppercase px-2 py-1 rounded text-sm ${
                                (response.data.ocrConfidenceLabel || response.data.confidenceLabel) === "high"
                                  ? "bg-green-900 text-green-300"
                                  : (response.data.ocrConfidenceLabel || response.data.confidenceLabel) === "medium"
                                  ? "bg-yellow-900 text-yellow-300"
                                  : "bg-red-900 text-red-300"
                              }`}
                            >
                              {(response.data.ocrConfidenceLabel || response.data.confidenceLabel || "low").toUpperCase()}
                            </span>
                            <span className="text-sm text-gray-500 ml-2">
                              ({(response.data.ocrConfidenceRaw ?? response.data.confidenceRaw ?? 0) * 100}%)
                            </span>
                          </div>
                          {response.data.automationStatus && response.data.automationStatus !== "APPLIED" && (
                            <p className="text-xs text-gray-500 italic">
                              OCR confidence measures text readability, not whether the job was updated.
                            </p>
                          )}
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

                      {/* Automation Status Section */}
                      {response.data.automationStatus && (
                        <div className="p-4 bg-gray-900 rounded border border-gray-700">
                          <h4 className="text-md font-semibold text-white mb-3">Automation Status</h4>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-400">Status: </span>
                              <span
                                className={`font-bold uppercase px-2 py-1 rounded text-sm ${
                                  response.data.automationStatus === "APPLIED"
                                    ? "bg-green-900 text-green-300"
                                    : response.data.automationStatus === "BLOCKED"
                                    ? "bg-red-900 text-red-300"
                                    : "bg-yellow-900 text-yellow-300"
                                }`}
                              >
                                {response.data.automationStatus}
                              </span>
                            </div>
                            {response.data.automationBlocked && response.data.automationBlockReason && (
                              <p className="text-sm text-red-300 mt-2">
                                {response.data.automationBlockReason === "NO_MATCHING_JOB_ROW"
                                  ? "No matching job in Sheet1"
                                  : response.data.automationBlockReason === "TEMPLATE_NOT_FOUND"
                                  ? "Template not found"
                                  : response.data.automationBlockReason === "TEMPLATE_NOT_CONFIGURED"
                                  ? "Template not configured"
                                  : response.data.automationBlockReason === "INVALID_CROP"
                                  ? "Invalid crop zone"
                                  : response.data.automationBlockReason === "CROP_TOO_SMALL"
                                  ? "Crop zone too small"
                                  : response.data.automationBlockReason}
                              </p>
                            )}
                            {response.data.automationStatus === "BLOCKED" && response.data.fixHref && (
                              <button
                                onClick={() => {
                                  setSelectedFixResponse({ fileId, response });
                                  setShowFixModal(true);
                                }}
                                className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors text-sm"
                              >
                                {response.data.fixAction || "Verify template"}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
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

      {/* Verify Modal */}
      {showFixModal && selectedFixResponse && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-white mb-4">Verify Template</h2>

            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-gray-200 mb-1">
                  {selectedFixResponse.response.data?.reasonTitle || "Verification Required"}
                </div>
                <div className="text-sm text-gray-400 mb-3">
                  {selectedFixResponse.response.data?.reasonMessage || "This item needs verification."}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  FM Key
                </label>
                <div className="text-sm text-gray-400">
                  {selectedFixResponse.response.data?.fmKey || "Unknown"}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-700">
                <button
                  onClick={() => setShowFixModal(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                >
                  Cancel
                </button>
                {selectedFixResponse.response.data?.fixHref && (
                  <>
                    <button
                      onClick={() => {
                        if (selectedFixResponse.response.data?.fixHref) {
                          window.open(selectedFixResponse.response.data.fixHref, "_blank", "noopener,noreferrer");
                        }
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                    >
                      Open Templates
                    </button>
                    <button
                      onClick={() => {
                        alert("Please re-upload the signed PDF after verifying the template. The retry feature will be available soon.");
                        setShowFixModal(false);
                      }}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
                    >
                      I verified it — retry
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FM Mismatch Modal */}
      {showMismatchModal && mismatchModalData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-white mb-4">⚠ FM Mismatch Detected</h2>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-300 mb-2">
                  You selected FM: <strong className="text-white">{mismatchModalData.selectedFm}</strong>
                </p>
                <p className="text-sm text-gray-300 mb-2">
                  This email appears to belong to: <strong className="text-white">{mismatchModalData.detectedFm}</strong>
                </p>
                <p className="text-xs text-gray-400 mt-3 italic">
                  "{mismatchModalData.emailSubject}"
                </p>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-gray-700">
                <button
                  onClick={() => {
                    setShowMismatchModal(false);
                    setMismatchModalData(null);
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setFmKey(mismatchModalData.detectedFm);
                    setShowMismatchModal(false);
                    setMismatchModalData(null);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  Switch FM to {mismatchModalData.detectedFm}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
