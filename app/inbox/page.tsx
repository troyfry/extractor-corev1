"use client";

import React, { useState, useEffect, useRef } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import type { GmailFoundEmail } from "@/lib/google/gmail";
import { WORK_ORDER_LABEL_NAME } from "@/lib/google/gmailConfig";
import { getAiHeaders } from "@/lib/byok-client";
import { ROUTES } from "@/lib/routes";
import Link from "next/link";

export default function InboxPage() {
  const [emails, setEmails] = useState<GmailFoundEmail[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<{
    workOrders: number;
    workOrderNumbers: string[];
    labelRemoved: boolean;
    messageId: string;
  } | null>(null);
  const [autoRemoveLabel, setAutoRemoveLabel] = useState(true);
  const [gmailLabel, setGmailLabel] = useState<string>("");
  const [currentLabelName, setCurrentLabelName] = useState<string>("Work Orders Queue");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [hasFmProfiles, setHasFmProfiles] = useState<boolean | null>(null);
  const [hasFmProfilesWithCoords, setHasFmProfilesWithCoords] = useState<boolean | null>(null);
  const [isCheckingFmProfiles, setIsCheckingFmProfiles] = useState(true);
  const [fmProfilesWithoutCoords, setFmProfilesWithoutCoords] = useState<string[]>([]);
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  // Helper function to sort emails by date (oldest first)
  const sortEmailsByDate = (emailList: GmailFoundEmail[]): GmailFoundEmail[] => {
    return [...emailList].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      // Handle invalid dates - put them at the end
      if (isNaN(dateA) && isNaN(dateB)) return 0;
      if (isNaN(dateA)) return 1; // Invalid dates go to end
      if (isNaN(dateB)) return -1; // Valid dates come first
      // Return oldest first (ascending order)
      return dateA - dateB;
    });
  };

  // Check for FM profiles on mount
  useEffect(() => {
    checkFmProfiles();
  }, []);

  // Load emails on mount
  useEffect(() => {
    loadEmails();
  }, []);

  const checkFmProfiles = async () => {
    setIsCheckingFmProfiles(true);
    try {
      const response = await fetch("/api/onboarding/fm-profiles");
      if (response.ok) {
        const data = await response.json();
        const profiles = data.profiles || [];
        setHasFmProfiles(profiles.length > 0);
        
        // Check if any profiles have coordinates set (wo_number_region with xPt, yPt, wPt, hPt)
        const profilesWithCoords = profiles.filter((p: any) => {
          const completeness = p.completeness;
          return completeness?.hasWoNumberRegion === true;
        });
        
        setHasFmProfilesWithCoords(profilesWithCoords.length > 0);
        
        // Track which profiles are missing coordinates
        const withoutCoords = profiles
          .filter((p: any) => !p.completeness?.hasWoNumberRegion)
          .map((p: any) => p.displayName || p.fmKey);
        setFmProfilesWithoutCoords(withoutCoords);
      } else {
        // If endpoint fails, assume no profiles (conservative approach)
        setHasFmProfiles(false);
        setHasFmProfilesWithCoords(false);
        setFmProfilesWithoutCoords([]);
      }
    } catch (err) {
      console.error("Failed to check FM profiles:", err);
      setHasFmProfiles(false);
      setHasFmProfilesWithCoords(false);
      setFmProfilesWithoutCoords([]);
    } finally {
      setIsCheckingFmProfiles(false);
    }
  };

  const loadEmails = async (pageToken?: string, reset: boolean = false) => {
    if (reset) {
      // Reset state for refresh
      setEmails([]);
      setNextPageToken(null);
      setSelectedEmails(new Set());
      setExpandedEmails(new Set());
    }

    if (pageToken) {
      setIsLoadingMore(true);
    } else {
      setIsLoadingEmails(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      if (pageToken) params.set("pageToken", pageToken);
      if (gmailLabel) params.set("label", gmailLabel);
      params.set("maxResults", "20"); // Load 20 emails per page

      const response = await fetch(`/api/gmail/list?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to load emails");
      }

      const data = await response.json();
      
      // Check for error message (e.g., no label configured)
      if (data.error && !data.emails) {
        setError(data.error);
        setEmails([]);
        setNextPageToken(null);
        setCurrentLabelName("No Label Configured");
        return;
      }
      
      if (pageToken) {
        // When loading more, combine with existing emails and sort entire list
        // This ensures the oldest email from ALL loaded pages appears first
        setEmails((prev) => sortEmailsByDate([...prev, ...(data.emails || [])]));
      } else {
        // Initial load or refresh - sort to ensure oldest email is first
        setEmails(sortEmailsByDate(data.emails || []));
        setSelectedEmails(new Set()); // Clear selection when loading new page
      }
      setNextPageToken(data.nextPageToken || null);
      // Update label name from API response
      if (data.labelName) {
        setCurrentLabelName(data.labelName);
      } else if (data.emails && data.emails.length === 0) {
        // If no label name but we have empty results, keep current name or set default
        setCurrentLabelName(currentLabelName || "Work Orders Queue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load emails");
    } finally {
      setIsLoadingEmails(false);
      setIsLoadingMore(false);
    }
  };

  const handleRefresh = () => {
    loadEmails(undefined, true);
  };

  const processEmail = async (messageId: string) => {
    // Check if FM profiles are configured
    if (hasFmProfiles === false) {
      setError("Please configure at least one FM Profile before processing work orders. Go to Settings or Onboarding to add an FM Profile.");
      return;
    }

    // Check if FM profiles have coordinates set (required for work order number extraction)
    if (hasFmProfilesWithCoords === false) {
      setError("Set work order number coordinates in Templates first.");
      return;
    }

    setIsProcessing(messageId);
    setError(null);
    setSuccessMessage(null);

    try {
      const headers = getAiHeaders();
      const response = await fetch("/api/gmail/process", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageId,
          autoRemoveLabel: autoRemoveLabel,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to process email");
      }

      const data = await response.json();
      
      // Extract work order numbers
      const workOrderNumbers = (data.workOrders || []).map((wo: any) => wo.workOrderNumber).filter(Boolean);
      
      // Check if any work orders were skipped (already signed)
      const skippedWorkOrders = data.meta?.skippedWorkOrders || [];
      if (skippedWorkOrders.length > 0) {
        const skippedMessage = skippedWorkOrders.length === 1
          ? `Work order ${skippedWorkOrders[0]} is already signed and was skipped.`
          : `${skippedWorkOrders.length} work orders are already signed and were skipped: ${skippedWorkOrders.join(", ")}`;
        setError(skippedMessage);
      }
      
      // Show success message with details (only if work orders were processed)
      if (data.workOrders?.length > 0) {
        setSuccessMessage({
          workOrders: data.workOrders.length,
          workOrderNumbers,
          labelRemoved: data.meta?.labelRemoved || false,
          messageId,
        });
      } else if (skippedWorkOrders.length === 0) {
        // No work orders found and none were skipped
        setError("No work orders were extracted from this email.");
      }

      // Remove processed email from list
      setEmails((prev) => prev.filter((e) => e.id !== messageId));
      
      // Auto-dismiss success message after 8 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 8000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process email");
    } finally {
      setIsProcessing(null);
    }
  };

  const processBatch = async () => {
    if (selectedEmails.size === 0) return;

    // Check if FM profiles are configured
    if (hasFmProfiles === false) {
      setError("Please configure at least one FM Profile before processing work orders. Go to Settings or Onboarding to add an FM Profile.");
      return;
    }

    // Check if FM profiles have coordinates set (required for work order number extraction)
    if (hasFmProfilesWithCoords === false) {
      setError("Set work order number coordinates in Templates first.");
      return;
    }

    setIsBatchProcessing(true);
    setError(null);
    setSuccessMessage(null);

    const messageIds = Array.from(selectedEmails);
    let totalWorkOrders = 0;
    const allWorkOrderNumbers: string[] = [];
    let processedCount = 0;
    let labelRemovedCount = 0;

    try {
      for (let i = 0; i < messageIds.length; i++) {
        const messageId = messageIds[i];
        
        // Update progress
        setBatchProgress({ current: i + 1, total: messageIds.length });

        try {
          const headers = getAiHeaders();
          const response = await fetch("/api/gmail/process", {
            method: "POST",
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messageId,
              autoRemoveLabel: autoRemoveLabel,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const workOrderNumbers = (data.workOrders || []).map((wo: any) => wo.workOrderNumber).filter(Boolean);
            totalWorkOrders += data.workOrders?.length || 0;
            allWorkOrderNumbers.push(...workOrderNumbers);
            processedCount++;
            if (data.meta?.labelRemoved) {
              labelRemovedCount++;
            }
            // Remove processed email from list
            setEmails((prev) => prev.filter((e) => e.id !== messageId));
          }
        } catch (err) {
          console.error(`Failed to process email ${messageId}:`, err);
          // Continue processing other emails
        }
      }

      // Clear progress
      setBatchProgress(null);

      // Show batch success message
      if (processedCount > 0) {
        setSuccessMessage({
          workOrders: totalWorkOrders,
          workOrderNumbers: allWorkOrderNumbers.slice(0, 10), // Show first 10
          labelRemoved: labelRemovedCount > 0,
          messageId: `${processedCount} of ${messageIds.length} emails`,
        });
        
        // Auto-dismiss success message after 10 seconds
        setTimeout(() => {
          setSuccessMessage(null);
        }, 10000);
      }
      
      setSelectedEmails(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process emails");
    } finally {
      setIsBatchProcessing(false);
      setBatchProgress(null);
    }
  };

  const toggleEmailSelection = (messageId: string) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const toggleEmailExpansion = (messageId: string) => {
    setExpandedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedEmails.size === emails.length && emails.length > 0) {
      // Deselect all
      setSelectedEmails(new Set());
    } else {
      // Select all visible emails
      setSelectedEmails(new Set(emails.map((e) => e.id)));
    }
  };

  const isAllSelected = emails.length > 0 && selectedEmails.size === emails.length;
  const isSomeSelected = selectedEmails.size > 0 && selectedEmails.size < emails.length;

  // Update checkbox indeterminate state
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  return (
    <AppShell>
      <MainNavigation currentMode="gmail" />

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-slate-50">{currentLabelName}</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={handleRefresh}
              disabled={isLoadingEmails}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              title="Refresh and show oldest 20 emails"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isLoadingEmails ? "Refreshing..." : "Refresh"}
            </button>
            <label className="flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={autoRemoveLabel}
                onChange={(e) => setAutoRemoveLabel(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Auto-remove label after processing</span>
            </label>
            {selectedEmails.size > 0 && (
              <button
                onClick={processBatch}
                disabled={isBatchProcessing || hasFmProfiles === false || hasFmProfilesWithCoords === false}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  hasFmProfiles === false 
                    ? "FM Profile required to process work orders" 
                    : hasFmProfilesWithCoords === false
                    ? "Work order number coordinates required - set crop zone in Templates"
                    : undefined
                }
              >
                {isBatchProcessing 
                  ? (batchProgress ? `Processing ${batchProgress.current} of ${batchProgress.total}` : "Processing...")
                  : `Process ${selectedEmails.size} Selected`}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-200">
            <div className="flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-4 text-red-300 hover:text-red-100"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* FM Profile Warning */}
        {hasFmProfiles === false && !isCheckingFmProfiles && (
          <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg text-yellow-200">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <p className="font-medium mb-1">FM Profile Required</p>
                <p className="text-sm text-yellow-300">
                  You need to configure at least one FM Profile before processing work orders. 
                  <Link href={ROUTES.onboardingFmProfiles} className="underline hover:text-yellow-100 ml-1">
                    Add an FM Profile
                  </Link>
                  {" or "}
                  <Link href={ROUTES.settings} className="underline hover:text-yellow-100">
                    go to Settings
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        )}

        {/* FM Profile Coordinates Warning */}
        {hasFmProfiles === true && hasFmProfilesWithCoords === false && !isCheckingFmProfiles && (
          <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-200">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <p className="font-medium mb-1">Work Order Number Coordinates Required</p>
                <p className="text-sm text-red-300 mb-2">
                  Cannot process emails: FM Profiles are missing work order number crop zone coordinates (x, y, width, height points).
                </p>
                {fmProfilesWithoutCoords.length > 0 && (
                  <p className="text-sm text-red-300 mb-2">
                    Profiles missing coordinates: <span className="font-medium">{fmProfilesWithoutCoords.join(", ")}</span>
                  </p>
                )}
                <p className="text-sm text-red-300">
                  Please set the work order number crop zone rectangle for at least one FM Profile in{" "}
                  <Link href={ROUTES.onboardingTemplates} className="underline hover:text-red-100 font-medium">
                    Templates
                  </Link>
                  {" before processing emails."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Batch Processing Progress */}
        {batchProgress && (
          <div className="p-4 bg-blue-900/20 border border-blue-700 rounded-lg text-blue-200">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <div>
                <p className="font-medium">Processing {batchProgress.current} of {batchProgress.total}</p>
                <p className="text-sm text-blue-300">Please wait while emails are being processed...</p>
              </div>
            </div>
          </div>
        )}

        {successMessage && (
          <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg text-green-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg font-semibold text-green-100">✓ Processing Complete</span>
                </div>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">{successMessage.workOrders}</span> work order{successMessage.workOrders !== 1 ? 's' : ''} extracted
                    {successMessage.workOrderNumbers.length > 0 && (
                      <span className="ml-2 text-green-300">
                        ({successMessage.workOrderNumbers.length > 10 
                          ? `${successMessage.workOrderNumbers.slice(0, 10).join(', ')} and ${successMessage.workOrderNumbers.length - 10} more`
                          : successMessage.workOrderNumbers.join(', ')})
                      </span>
                    )}
                  </p>
                  {successMessage.labelRemoved && (
                    <p className="text-green-300">✓ Label removed from email</p>
                  )}
                  <p className="text-green-400 text-xs mt-2">
                    Processed: {successMessage.messageId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSuccessMessage(null)}
                className="ml-4 text-green-300 hover:text-green-100 text-xl leading-none"
              >
                ×
              </button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Load More Button - Above email list */}
          {nextPageToken && !isLoadingEmails && emails.length > 0 && (
            <div className="text-center py-4">
              <button
                onClick={() => loadEmails(nextPageToken)}
                disabled={isLoadingMore}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingMore ? "Loading..." : `Load More (${emails.length} shown, more available)`}
              </button>
              <p className="text-sm text-slate-400 mt-2">
                Showing {emails.length} email{emails.length !== 1 ? 's' : ''} (oldest first)
              </p>
            </div>
          )}

          {isLoadingEmails ? (
            <div className="text-center text-slate-400 py-8">Loading emails...</div>
          ) : emails.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              {currentLabelName && currentLabelName !== "Gmail Inbox" ? (
                <>
                  No emails found with label "{currentLabelName}"
                  <p className="text-sm text-slate-500 mt-2">
                    Make sure emails are labeled with "{currentLabelName}" and contain PDF attachments.
                  </p>
                </>
              ) : (
                <>
                  No work order queue label configured
                  <p className="text-sm text-slate-500 mt-2">
                    Please complete onboarding or configure Gmail labels in Settings.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Select All Header */}
              <div className="flex items-center gap-3 pb-2 border-b border-slate-700">
                <input
                  type="checkbox"
                  ref={selectAllCheckboxRef}
                  checked={isAllSelected}
                  onChange={selectAll}
                  className="rounded"
                />
                <span className="text-sm text-slate-300">
                  {isAllSelected
                    ? "Deselect All"
                    : isSomeSelected
                    ? `${selectedEmails.size} of ${emails.length} selected`
                    : `Select All (${emails.length} emails)`}
                </span>
              </div>
              {emails.map((email) => (
              <div
                key={email.id}
                className="border border-slate-700 rounded-lg p-4 bg-slate-800 hover:bg-slate-750 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <input
                    type="checkbox"
                    checked={selectedEmails.has(email.id)}
                    onChange={() => toggleEmailSelection(email.id)}
                    className="mt-1 rounded"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-slate-50">{email.from}</h3>
                        <p className="text-sm text-slate-400">{email.subject}</p>
                        <p className="text-xs text-slate-500 mt-1">{email.date}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleEmailExpansion(email.id)}
                          className="px-3 py-1 text-sm text-slate-300 hover:text-slate-50 border border-slate-600 rounded hover:bg-slate-700 transition-colors"
                        >
                          {expandedEmails.has(email.id) ? "Hide" : "Show"} Details
                        </button>
                        <button
                          onClick={() => processEmail(email.id)}
                          disabled={isProcessing === email.id || hasFmProfiles === false || hasFmProfilesWithCoords === false}
                          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            hasFmProfiles === false 
                              ? "FM Profile required to process work orders" 
                              : hasFmProfilesWithCoords === false
                              ? "Work order number coordinates required - set crop zone in Templates"
                              : undefined
                          }
                        >
                          {isProcessing === email.id ? "Processing..." : "Process"}
                        </button>
                      </div>
                    </div>
                    {expandedEmails.has(email.id) && (
                      <div className="mt-4 p-4 bg-slate-900 rounded border border-slate-700">
                        <p className="text-sm text-slate-300 whitespace-pre-wrap">{email.snippet}</p>
                        {email.attachmentCount > 0 && (
                          <div className="mt-4">
                            <p className="text-sm font-medium text-slate-400 mb-2">
                              PDF Attachments: {email.attachmentCount}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              ))}
            </>
          )}
          
          {/* Show "all emails" message when no more pages */}
          {!nextPageToken && emails.length > 0 && !isLoadingEmails && (
            <div className="text-center py-4">
              <p className="text-sm text-slate-400">
                Showing all {emails.length} email{emails.length !== 1 ? 's' : ''} (oldest first)
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

