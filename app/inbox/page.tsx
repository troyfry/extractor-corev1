"use client";

import React, { useState, useEffect, useRef } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import type { GmailFoundEmail } from "@/lib/google/gmail";
import { WORK_ORDER_LABEL_NAME } from "@/lib/google/gmailConfig";

export default function InboxPage() {
  const [emails, setEmails] = useState<GmailFoundEmail[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<{
    workOrders: number;
    workOrderNumbers: string[];
    labelRemoved: boolean;
    messageId: string;
  } | null>(null);
  const [autoRemoveLabel, setAutoRemoveLabel] = useState(true);
  const [gmailLabel, setGmailLabel] = useState<string>("");
  const [currentLabelName, setCurrentLabelName] = useState<string>("Gmail Inbox");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
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

  // Load emails on mount
  useEffect(() => {
    loadEmails();
  }, []);

  const loadEmails = async (pageToken?: string) => {
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
      params.set("maxResults", "20"); // Show 20 emails per page

      const response = await fetch(`/api/gmail/list?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to load emails");
      }

      const data = await response.json();
      if (pageToken) {
        // When loading more, combine and sort the entire list to ensure proper chronological order
        // This ensures the oldest email from ALL loaded pages appears first
        setEmails((prev) => sortEmailsByDate([...prev, ...data.emails]));
      } else {
        // Initial load - sort to ensure oldest email is first
        setEmails(sortEmailsByDate(data.emails || []));
        setSelectedEmails(new Set()); // Clear selection when loading new page
      }
      setNextPageToken(data.nextPageToken || null);
      // Update label name from API response
      if (data.labelName) {
        setCurrentLabelName(data.labelName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load emails");
    } finally {
      setIsLoadingEmails(false);
      setIsLoadingMore(false);
    }
  };

  const processEmail = async (messageId: string) => {
    setIsProcessing(messageId);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/gmail/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      
      // Show success message with details
      setSuccessMessage({
        workOrders: data.workOrders?.length || 0,
        workOrderNumbers,
        labelRemoved: data.meta?.labelRemoved || false,
        messageId,
      });

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

    setIsBatchProcessing(true);
    setError(null);
    setSuccessMessage(null);

    const messageIds = Array.from(selectedEmails);
    let totalWorkOrders = 0;
    const allWorkOrderNumbers: string[] = [];
    let processedCount = 0;
    let labelRemovedCount = 0;

    try {
      for (const messageId of messageIds) {
        try {
          const response = await fetch("/api/gmail/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
                disabled={isBatchProcessing}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {isBatchProcessing ? "Processing..." : `Process ${selectedEmails.size} Selected`}
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
          {isLoadingEmails ? (
            <div className="text-center text-slate-400 py-8">Loading emails...</div>
          ) : emails.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              No emails found with label "{WORK_ORDER_LABEL_NAME}"
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
                          disabled={isProcessing === email.id}
                          className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
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
        </div>

        {nextPageToken && (
          <div className="text-center">
            <button
              onClick={() => loadEmails(nextPageToken)}
              disabled={isLoadingMore}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {isLoadingMore ? "Loading..." : "Load More"}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

