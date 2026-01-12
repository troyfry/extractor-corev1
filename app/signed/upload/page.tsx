"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import MainNavigation from "@/components/layout/MainNavigation";
import { useUserOpenAIKey } from "@/lib/useUserOpenAIKey";
import { getAiHeaders } from "@/lib/byok-client";

type ExtractionResult = {
  workOrderNumber: string | null;
  method: "DIGITAL_TEXT" | "OCR" | "AI_RESCUE";
  confidence: number;
  rationale?: string | null;
};

type ProcessingResult = {
  mode: "UPDATED" | "NEEDS_REVIEW" | "ALREADY_PROCESSED";
  data: {
    woNumber: string | null;
    extraction: ExtractionResult | null;
    reason?: string | null;
    snippetUrl?: string | null;
    automationStatus?: "REVIEW" | "APPLIED" | "BLOCKED";
    automationBlocked?: boolean;
    automationBlockReason?: string | null;
    confidenceRaw?: number;
    confidenceLabel?: string;
  };
};

type FmProfile = {
  fmKey: string;
  displayName: string;
  senderDomains?: string[];
  senderEmails?: string[];
  completeness?: {
    score: number;
    hasWoNumberRegion: boolean;
    hasPage: boolean;
    hasSenderDomains: boolean;
    completeness: "HIGH" | "MEDIUM" | "LOW";
  };
};

type GmailEmail = {
  messageId: string;
  threadId: string | null;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  attachments: Array<{
    filename: string;
    attachmentId: string;
    mimeType: string;
  }>;
};

export default function SignedUploadPage() {
  const [fmKey, setFmKey] = useState("");
  const [profiles, setProfiles] = useState<FmProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [sourceMode, setSourceMode] = useState<"upload" | "gmail">("upload");
  
  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  
  // Gmail state
  const [gmailLabel, setGmailLabel] = useState("signed_WOs");
  const [gmailEmails, setGmailEmails] = useState<GmailEmail[]>([]);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [selectedGmailEmails, setSelectedGmailEmails] = useState<Set<string>>(new Set());
  const [processingGmail, setProcessingGmail] = useState<Set<string>>(new Set());
  const [gmailResults, setGmailResults] = useState<Map<string, ProcessingResult>>(new Map());
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  
  const [error, setError] = useState<string | null>(null);
  const { key: openaiKey, hasKey } = useUserOpenAIKey();

  // Load FM profiles on mount
  useEffect(() => {
    async function loadProfiles() {
      try {
        setLoadingProfiles(true);
        const response = await fetch("/api/onboarding/fm-profiles");
        
        if (!response.ok) {
          console.warn("Failed to load FM profiles");
          setProfiles([]);
          return;
        }

        const data = await response.json();
        setProfiles(data.profiles || []);
        
        // Auto-select if only one profile
        if (data.profiles && data.profiles.length === 1) {
          setFmKey(data.profiles[0].fmKey);
        }
      } catch (err) {
        console.error("Error loading FM profiles:", err);
        setProfiles([]);
      } finally {
        setLoadingProfiles(false);
      }
    }

    loadProfiles();
  }, []);

  // Match FM profile by sender email/domain
  function matchFmProfileBySender(senderEmail: string): string | null {
    if (!profiles.length || !senderEmail) return null;
    
    const emailMatch = senderEmail.match(/@([^\s>]+)/);
    const senderDomain = emailMatch ? emailMatch[1].toLowerCase().trim() : null;
    
    if (!senderDomain) return null;
    
    for (const profile of profiles) {
      if (!profile.senderDomains || profile.senderDomains.length === 0) continue;
      
      for (const domain of profile.senderDomains) {
        const profileDomain = domain.toLowerCase().trim();
        
        if (senderDomain === profileDomain) {
          return profile.fmKey;
        }
        
        if (senderDomain.endsWith(`.${profileDomain}`) || profileDomain.endsWith(`.${senderDomain}`)) {
          return profile.fmKey;
        }
        
        if (senderDomain.startsWith(`${profileDomain}.`) || profileDomain.startsWith(`${senderDomain}.`)) {
          return profile.fmKey;
        }
      }
    }
    
    return null;
  }

  // Get likely FM from subject (for display only)
  function getLikelyFmFromSubject(subject: string): string | null {
    const s = (subject || "").toLowerCase();
    for (const profile of profiles) {
      const fmKeyLower = profile.fmKey.toLowerCase();
      if (s.includes(fmKeyLower)) {
        return profile.fmKey;
      }
    }
    return null;
  }

  // Fetch Gmail emails
  async function fetchGmailEmails() {
    if (!fmKey.trim()) {
      setError("Please select an FM Profile first");
      return;
    }

    setLoadingGmail(true);
    setError(null);
    setGmailEmails([]);
    setSelectedGmailEmails(new Set());
    
    try {
      const url = new URL("/api/gmail/signed", window.location.origin);
      if (gmailLabel.trim()) {
        url.searchParams.set("label", gmailLabel.trim());
      }
      
      const response = await fetch(url.toString());
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch Gmail emails");
      }
      
      const data = await response.json();
      setGmailEmails(data.emails || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Gmail emails");
    } finally {
      setLoadingGmail(false);
    }
  }

  // Toggle email selection
  function toggleEmailSelection(messageId: string) {
    setSelectedGmailEmails((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  // Select all emails
  function selectAllEmails() {
    setSelectedGmailEmails(new Set(gmailEmails.map(e => e.messageId)));
  }

  // Process selected Gmail emails
  async function processSelectedEmails() {
    if (selectedGmailEmails.size === 0) {
      setError("Please select at least one email");
      return;
    }

    if (!fmKey.trim()) {
      setError("Please select an FM Profile");
      return;
    }

    setProcessingGmail(new Set(Array.from(selectedGmailEmails)));
    setError(null);

    const headers = getAiHeaders();
    const results: Array<{ key: string; result: ProcessingResult }> = [];
    const errors: Array<{ key: string; error: string }> = [];

    try {
      for (const messageId of selectedGmailEmails) {
        const email = gmailEmails.find(e => e.messageId === messageId);
        if (!email) continue;

        for (const attachment of email.attachments) {
          const processingKey = `${email.messageId}-${attachment.attachmentId}`;
          
          try {
            const response = await fetch("/api/signed/process-gmail", {
              method: "POST",
              headers: {
                ...headers,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messageId: email.messageId,
                attachmentId: attachment.attachmentId,
                filename: attachment.filename,
                fmKey: fmKey.trim(),
              }),
            });
            
            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error || "Failed to process attachment");
            }
            
            const data = await response.json();
            results.push({ key: processingKey, result: data });
          } catch (err) {
            errors.push({
              key: processingKey,
              error: err instanceof Error ? err.message : "Failed to process attachment",
            });
          }
        }
      }

      setGmailResults((prev) => {
        const next = new Map(prev);
        results.forEach(({ key, result }) => next.set(key, result));
        return next;
      });

      if (errors.length > 0) {
        setError(`Processed ${results.length} attachment(s), ${errors.length} failed`);
      } else {
        setError(null);
      }
    } finally {
      setProcessingGmail(new Set());
    }
  }

  // Handle file upload
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please select a file");
      return;
    }
    
    if (!fmKey.trim()) {
      setError("Please select an FM Profile");
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fmKey", fmKey.trim());

      const headers = getAiHeaders();

      const response = await fetch("/api/signed/process", {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to process signed PDF");
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process PDF");
    } finally {
      setProcessing(false);
    }
  }

  // No FM profiles message
  if (!loadingProfiles && profiles.length === 0) {
    return (
      <>
        <MainNavigation currentMode="signed" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-white mb-2">Signed Work Orders</h1>
              <p className="text-sm text-gray-400">
                Match signed work orders to existing jobs and mark them complete.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
              <div className="max-w-md mx-auto">
                <p className="text-gray-300 text-lg mb-4">
                  Add an FM Profile first so we know how to read and match your signed work orders.
                </p>
                <Link
                  href={ROUTES.onboardingFmProfiles}
                  className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  Add FM Profile
                </Link>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <MainNavigation currentMode="signed" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-4xl mx-auto px-4 pb-8">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">Signed Work Orders</h1>
            <p className="text-sm text-gray-400">
              Match signed work orders to existing jobs and mark them complete.
            </p>
          </div>

          {/* Step 1: Select FM */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-4">
            <h2 className="text-lg font-semibold text-white mb-4">Step 1 — Select Facility Manager (FM)</h2>
            <div>
              {loadingProfiles ? (
                <div className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded text-gray-400 text-sm">
                  Loading profiles...
                </div>
              ) : (
                <div>
                  <select
                    value={fmKey}
                    onChange={(e) => setFmKey(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">- Select FM Key -</option>
                    {profiles.map((profile) => {
                      const hasWoRegion = profile.completeness?.hasWoNumberRegion ?? false;
                      const badge = hasWoRegion ? "✅" : "⚠️";
                      const badgeText = hasWoRegion 
                        ? "WO# region configured" 
                        : "No WO# region";
                      
                      return (
                        <option key={profile.fmKey} value={profile.fmKey}>
                          {badge} {profile.displayName} ({profile.fmKey}) - {badgeText}
                        </option>
                      );
                    })}
                  </select>
                  {fmKey && (() => {
                    const selectedProfile = profiles.find(p => p.fmKey === fmKey);
                    const completeness = selectedProfile?.completeness;
                    if (!completeness) return null;
                    
                    return (
                      <div className="mt-2 text-xs">
                        {completeness.hasWoNumberRegion ? (
                          <div className="flex items-center gap-2 text-green-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>WO# region configured — high trust extraction</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-yellow-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span>No WO# region — requires review more often</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">
                You are processing signed work orders for this FM only.
              </p>
            </div>
          </div>

          {/* Step 2: Import Method */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-4">
            <h2 className="text-lg font-semibold text-white mb-4">Step 2 — How do you want to import signed PDFs?</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="sourceMode"
                  value="upload"
                  checked={sourceMode === "upload"}
                  onChange={(e) => setSourceMode("upload")}
                  className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-700 focus:ring-blue-500"
                />
                <span className="text-white">Upload PDF files</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="sourceMode"
                  value="gmail"
                  checked={sourceMode === "gmail"}
                  onChange={(e) => setSourceMode("gmail")}
                  className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-700 focus:ring-blue-500"
                />
                <span className="text-white">Get from Gmail</span>
              </label>
            </div>
          </div>

          {/* Upload Section */}
          {sourceMode === "upload" && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-4">
              <h2 className="text-lg font-semibold text-white mb-4">Upload Signed PDFs</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded text-white file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                    required
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    You can upload multiple PDF files at once (one work order per PDF)
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={processing || !file || !fmKey.trim()}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                >
                  {processing ? "Processing..." : "Upload & Process"}
                </button>
              </form>
            </div>
          )}

          {/* Gmail Section */}
          {sourceMode === "gmail" && (
            <div className="space-y-4">
              {/* Warning Banner */}
              {fmKey && (
                <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="text-yellow-300 font-medium">Processing Gmail for FM: {fmKey}</p>
                    <p className="text-yellow-200 text-sm mt-1">
                      Only emails containing signed work orders for this FM should be selected.
                    </p>
                  </div>
                </div>
              )}

              {/* Gmail Label Input */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Gmail Label:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={gmailLabel}
                      onChange={(e) => setGmailLabel(e.target.value)}
                      className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-blue-500"
                      placeholder="signed_WOs"
                    />
                    {gmailLabel && (
                      <button
                        onClick={() => setGmailLabel("")}
                        className="px-3 py-2 text-gray-400 hover:text-white"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={fetchGmailEmails}
                  disabled={loadingGmail || !fmKey.trim()}
                  className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                >
                  {loadingGmail ? "Loading..." : "Load Signed PDFs for Selected FM"}
                </button>

                {fmKey && (
                  <p className="text-xs text-gray-400 mt-3">
                    Only select emails that belong to {fmKey}
                  </p>
                )}

                {/* Search Criteria Box */}
                <div className="mt-4 p-3 bg-gray-900 rounded border border-gray-700">
                  <p className="text-xs text-gray-300 mb-1">
                    <strong>Search Criteria:</strong> Emails with PDF attachments in label "{gmailLabel || "signed_WOs"}"
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    <strong>Note:</strong> Subject line does NOT matter. Emails with any subject (e.g., "paperwork", "signed docs", etc.) will be included as long as they have PDF attachments.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Label names are case-sensitive. Make sure the label exists in your Gmail and contains emails with PDF attachments.
                  </p>
                </div>
              </div>

              {/* Gmail Emails Table */}
              {gmailEmails.length > 0 && (
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">Gmail Emails ({gmailEmails.length})</h3>
                    <button
                      onClick={selectAllEmails}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
                    >
                      Select All
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-700">
                      <thead>
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase w-8"></th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">SUBJECT</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">DATE</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">PDFS</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">LIKELY FM</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {gmailEmails.map((email) => {
                          const likelyFm = getLikelyFmFromSubject(email.subject);
                          const matchedFm = matchFmProfileBySender(email.from);
                          const isSelected = selectedGmailEmails.has(email.messageId);
                          const isProcessing = Array.from(processingGmail).some(id => email.messageId === id);
                          const isExpanded = expandedEmails.has(email.messageId);
                          
                          // Get all results for this email's attachments
                          const emailResults = email.attachments.map(att => {
                            const key = `${email.messageId}-${att.attachmentId}`;
                            return { attachment: att, result: gmailResults.get(key) };
                          });
                          
                          const hasResults = emailResults.some(r => r.result);
                          const hasBlocked = emailResults.some(r => r.result?.mode === "ALREADY_PROCESSED" || r.result?.data.automationBlocked);
                          
                          return (
                            <React.Fragment key={email.messageId}>
                              <tr className={isSelected ? "bg-gray-700/50" : ""}>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => {
                                      setExpandedEmails((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(email.messageId)) {
                                          next.delete(email.messageId);
                                        } else {
                                          next.add(email.messageId);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="text-gray-400 hover:text-white"
                                  >
                                    <svg
                                      className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                  </button>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleEmailSelection(email.messageId)}
                                      disabled={isProcessing}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-4 h-4 text-blue-600 bg-gray-900 border-gray-700 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-white">{email.subject || "(No subject)"}</span>
                                    {hasBlocked && (
                                      <span className="px-2 py-0.5 bg-red-900/30 text-red-300 rounded text-xs">
                                        Blocked
                                      </span>
                                    )}
                                    {hasResults && !hasBlocked && (
                                      <span className="px-2 py-0.5 bg-green-900/30 text-green-300 rounded text-xs">
                                        Processed
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-300">
                                  {new Date(email.date).toLocaleDateString()}
                                </td>
                                <td className="px-3 py-2 text-sm text-green-400 font-medium">
                                  {email.attachments.length}
                                </td>
                                <td className="px-3 py-2 text-sm">
                                  {matchedFm ? (
                                    <span className="text-blue-400">Likely: {matchedFm}</span>
                                  ) : likelyFm ? (
                                    <span className="text-blue-400">Likely: {likelyFm}</span>
                                  ) : (
                                    <span className="text-gray-500">Unknown FM</span>
                                  )}
                                </td>
                              </tr>
                              {/* Expanded Email Details */}
                              {isExpanded && (
                                <tr>
                                  <td colSpan={5} className="px-3 py-3 bg-gray-900/50">
                                    <div className="space-y-3">
                                      {/* Email Details */}
                                      <div className="text-xs text-gray-400 space-y-1">
                                        <div><strong>From:</strong> {email.from}</div>
                                        <div><strong>Date:</strong> {new Date(email.date).toLocaleString()}</div>
                                        {email.snippet && (
                                          <div><strong>Snippet:</strong> {email.snippet}</div>
                                        )}
                                      </div>
                                      
                                      {/* Attachment Results */}
                                      {email.attachments.length > 0 && (
                                        <div className="space-y-2 pt-2 border-t border-gray-700">
                                          <div className="text-xs font-semibold text-gray-300">Attachments:</div>
                                          {email.attachments.map((attachment) => {
                                            const processingKey = `${email.messageId}-${attachment.attachmentId}`;
                                            const result = gmailResults.get(processingKey);
                                            const isProcessingAtt = processingGmail.has(processingKey);
                                            
                                            return (
                                              <div
                                                key={attachment.attachmentId}
                                                className="bg-gray-800 rounded border border-gray-700 p-3"
                                              >
                                                <div className="flex items-center justify-between mb-2">
                                                  <div className="text-sm text-gray-300">
                                                    <span className="mr-1">📎</span>
                                                    {attachment.filename}
                                                  </div>
                                                  {isProcessingAtt && (
                                                    <span className="text-xs text-blue-400">Processing...</span>
                                                  )}
                                                  {result && (
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                      result.mode === "ALREADY_PROCESSED" || result.data.automationBlocked
                                                        ? "bg-red-900/30 text-red-300"
                                                        : result.mode === "UPDATED"
                                                        ? "bg-green-900/30 text-green-300"
                                                        : "bg-yellow-900/30 text-yellow-300"
                                                    }`}>
                                                      {result.mode === "ALREADY_PROCESSED" || result.data.automationBlocked
                                                        ? "Blocked - Already Processed"
                                                        : result.mode === "UPDATED"
                                                        ? "Updated"
                                                        : "Needs Review"}
                                                    </span>
                                                  )}
                                                </div>
                                                
                                                {/* Extraction Results */}
                                                {result && result.data.extraction && (
                                                  <div className="mt-2 pt-2 border-t border-gray-700 space-y-2">
                                                    {result.data.extraction.workOrderNumber && (
                                                      <div>
                                                        <span className="text-xs text-gray-400">Work Order #:</span>
                                                        <span className="text-sm font-mono text-white ml-2">
                                                          {result.data.extraction.workOrderNumber}
                                                        </span>
                                                      </div>
                                                    )}
                                                    
                                                    {/* Confidence Scoring */}
                                                    <div className="flex items-center gap-4">
                                                      <div>
                                                        <span className="text-xs text-gray-400">Method:</span>
                                                        <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                                                          result.data.extraction.method === "DIGITAL_TEXT"
                                                            ? "bg-green-900/50 text-green-300"
                                                            : result.data.extraction.method === "OCR"
                                                            ? "bg-blue-900/50 text-blue-300"
                                                            : "bg-purple-900/50 text-purple-300"
                                                        }`}>
                                                          {result.data.extraction.method.replace("_", " ")}
                                                        </span>
                                                      </div>
                                                      <div>
                                                        <span className="text-xs text-gray-400">Confidence:</span>
                                                        <span className={`ml-2 text-sm font-semibold ${
                                                          (result.data.extraction.confidence || result.data.confidenceRaw || 0) >= 0.9
                                                            ? "text-green-400"
                                                            : (result.data.extraction.confidence || result.data.confidenceRaw || 0) >= 0.7
                                                            ? "text-yellow-400"
                                                            : "text-red-400"
                                                        }`}>
                                                          {Math.round((result.data.extraction.confidence || result.data.confidenceRaw || 0) * 100)}%
                                                        </span>
                                                        <span className="text-xs text-gray-400 ml-1">
                                                          ({result.data.confidenceLabel || "unknown"})
                                                        </span>
                                                      </div>
                                                    </div>
                                                    
                                                    {result.data.extraction.rationale && (
                                                      <div className="text-xs text-gray-400 italic">
                                                        {result.data.extraction.rationale}
                                                      </div>
                                                    )}
                                                    
                                                    {result.mode === "NEEDS_REVIEW" && (
                                                      <Link
                                                        href={ROUTES.signedNeedsReview}
                                                        className="inline-block mt-2 px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-xs font-medium transition-colors"
                                                      >
                                                        Go to Needs Review →
                                                      </Link>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {selectedGmailEmails.size > 0 && (
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={processSelectedEmails}
                        disabled={processingGmail.size > 0}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                      >
                        {processingGmail.size > 0 ? "Processing..." : `Process ${selectedGmailEmails.size} Selected Email(s)`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded text-red-300">
              {error}
            </div>
          )}

          {/* Results Display (Upload) */}
          {result && result.data.extraction && sourceMode === "upload" && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-4">
              <h2 className="text-lg font-semibold text-white mb-4">Extraction Results</h2>
              <div className="space-y-4">
                {result.data.extraction.workOrderNumber && (
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Detected Work Order #</div>
                    <div className="text-2xl font-mono text-white">
                      {result.data.extraction.workOrderNumber}
                    </div>
                  </div>
                )}
                <div className="flex gap-4 pt-4 border-t border-gray-700">
                  {result.mode === "NEEDS_REVIEW" && (
                    <Link
                      href={ROUTES.signedNeedsReview}
                      className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded font-medium transition-colors"
                    >
                      Go to Needs Review →
                    </Link>
                  )}
                  <Link
                    href={ROUTES.workOrders}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors"
                  >
                    View Work Orders →
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
