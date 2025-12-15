"use client";

import React, { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import ParsedWorkOrdersPreview from "@/components/manual/ParsedWorkOrdersPreview";
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";
import { useUserOpenAIKey } from "@/lib/useUserOpenAIKey";
import { requiresBYOK } from "@/lib/plan-helpers";
import { canUseProFeatures } from "@/lib/planVisibility";
import { clearUserApiKey } from "@/lib/byok";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ParsedWorkOrder, ManualProcessResponse } from "@/lib/workOrders/parsedTypes";
import type { GmailFoundEmail } from "@/lib/google/gmail";
import { WORK_ORDER_LABEL_NAME } from "@/lib/google/gmailConfig";

export default function GmailPage() {
  const [emails, setEmails] = useState<GmailFoundEmail[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isProcessing, setIsProcessing] = useState<string | null>(null); // messageId being processed
  const [isBatchProcessing, setIsBatchProcessing] = useState(false); // Batch processing state
  const [accumulatedWorkOrders, setAccumulatedWorkOrders] = useState<ParsedWorkOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRemoveLabel, setAutoRemoveLabel] = useState(true); // Default ON
  const [gmailLabel, setGmailLabel] = useState<string>(""); // Optional Gmail label filter
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set()); // Selected emails for batch processing
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set()); // Expanded emails to show details
  const [hasSpreadsheetId, setHasSpreadsheetId] = useState<boolean | null>(null);
  
  const { plan } = useCurrentPlan();
  const { key: openaiKey } = useUserOpenAIKey();
  const router = useRouter();
  
  // Check if Gmail import is available for current plan
  // Note: Free plan does NOT have Gmail feature, even in dev mode
  const canUseGmail = hasFeature(plan, "canUseGmailImport");
  const canUsePro = canUseProFeatures(plan);
  
  // For Free plan, Gmail is never available (even with dev override for features)
  // Dev override only affects feature behavior, not navigation visibility
  const isFreePlan = plan === "FREE_BYOK";
  
  // Auto-clear BYOK key when plan is not Free
  useEffect(() => {
    if (plan !== "FREE_BYOK") {
      clearUserApiKey();
    }
  }, [plan]);
  
  // Immediately redirect Free users to free tier page
  // Free plan users should NEVER access Gmail/Inbox page
  useEffect(() => {
    if (isFreePlan && !canUseGmail) {
      router.replace("/free");
      return;
    }
    
    // Check if spreadsheet ID is configured (only for Pro/Premium users with Gmail access)
    // Free plan users don't need Google Sheets integration
    if (canUseGmail && !isFreePlan) {
      const checkSpreadsheetId = async () => {
        try {
          const response = await fetch("/api/user-settings/spreadsheet-id");
          if (response.ok) {
            const data = await response.json();
            setHasSpreadsheetId(!!data.googleSheetsSpreadsheetId);
          } else {
            setHasSpreadsheetId(false);
          }
        } catch (error) {
          console.error("Error checking spreadsheet ID:", error);
          setHasSpreadsheetId(false);
        }
      };
      checkSpreadsheetId();
    }
  }, [isFreePlan, canUseGmail, router]);
  
  // For Free users, immediately return redirecting state
  // This prevents any Gmail UI from rendering
  // Pass currentMode="file" to ensure navigation shows "From File" as active
  // Free plan users should NEVER see Gmail/Inbox page, even in dev mode
  if (isFreePlan && !canUseGmail) {
    return (
      <AppShell>
        <MainNavigation currentMode="file" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="text-center text-gray-400">Redirecting to file upload...</div>
        </div>
      </AppShell>
    );
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
    const added = new Set<string>();
    newWorkOrders.forEach((wo) => {
      const key = wo.workOrderNumber.toLowerCase().trim();
      if (!existingMap.has(key)) {
        existingMap.set(key, wo);
        added.add(key);
      } else {
        // Check if new one has more complete data
        const existingWo = existingMap.get(key)!;
        const existingScore = Object.values(existingWo).filter((v) => v !== null && v !== "").length;
        const newScore = Object.values(wo).filter((v) => v !== null && v !== "").length;
        if (newScore > existingScore) {
          existingMap.set(key, wo);
          added.add(key);
        } else {
          console.log(`[Deduplication] Skipping duplicate work order: ${wo.workOrderNumber} (existing has ${existingScore} fields, new has ${newScore} fields)`);
        }
      }
    });

    return Array.from(existingMap.values());
  };

  const handleFindEmails = async () => {
    setIsLoadingEmails(true);
    setError(null);
    
    try {
      // Build URL with optional label parameter
      const url = new URL("/api/gmail/list", window.location.origin);
      if (gmailLabel.trim()) {
        url.searchParams.set("label", gmailLabel.trim());
      }
      
      const response = await fetch(url.toString());
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch emails" }));
        throw new Error(errorData.error || "Failed to fetch emails");
      }
      
      const data = await response.json();
      setEmails(data.emails || []);
    } catch (error) {
      console.error("Error fetching Gmail emails:", error);
      setError(error instanceof Error ? error.message : "Failed to fetch emails");
    } finally {
      setIsLoadingEmails(false);
    }
  };

  const handleProcessEmail = async (messageId: string) => {
    setIsProcessing(messageId);
    setError(null);
    
    try {
      const response = await fetch("/api/gmail/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          messageId,
          autoRemoveLabel,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to process email" }));
        throw new Error(errorData.error || "Failed to process email");
      }
      
      const processData: ManualProcessResponse = await response.json();
      
      // Accumulate parsed work orders
      const newWorkOrders = processData.workOrders || [];
      console.log(`[Single Process] Email ${messageId}: Received ${newWorkOrders.length} work order(s)`, {
        workOrders: newWorkOrders,
        meta: processData.meta,
      });
      
      if (newWorkOrders.length > 0) {
        setAccumulatedWorkOrders((prev) => {
          const deduplicated = deduplicateWorkOrders(prev, newWorkOrders);
          const duplicatesSkipped = prev.length + newWorkOrders.length - deduplicated.length;
          console.log(`[Single Process] Updated accumulated work orders: ${prev.length} -> ${deduplicated.length} (${duplicatesSkipped} duplicate(s) skipped)`);
          return deduplicated;
        });
      } else {
        console.warn(`[Single Process] Email ${messageId}: No work orders extracted. Check API logs for details.`);
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
      
      // Update email list if label was removed
      if (autoRemoveLabel && processData.meta.labelRemoved) {
        // Remove the email from the list since label was removed
        setEmails((prev) => prev.filter((e) => e.id !== messageId));
        setSelectedEmails((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
      
      // Show success message (only for single processing, not batch)
      if (!isBatchProcessing) {
        const workOrderCount = newWorkOrders.length;
        const totalCount = accumulatedWorkOrders.length + newWorkOrders.length;
        const labelStatus = autoRemoveLabel && processData.meta.labelRemoved
          ? " Label removed from email."
          : "";
        alert(
          workOrderCount > 0
            ? `Successfully parsed ${workOrderCount} work order(s) from email. Total: ${totalCount} work order(s) in session.${labelStatus}`
            : `Email processed but no work orders were extracted.${labelStatus}`
        );
      }
    } catch (error) {
      console.error("Error processing email:", error);
      setError(error instanceof Error ? error.message : "Failed to process email");
      if (!isBatchProcessing) {
        alert(`Failed to process email: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } finally {
      setIsProcessing(null);
    }
  };

  const handleToggleSelectEmail = (messageId: string) => {
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

  const handleToggleExpandEmail = (messageId: string) => {
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

  const handleSelectAll = () => {
    const emailsWithPdfs = emails.filter((e) => e.attachmentCount > 0);
    if (selectedEmails.size === emailsWithPdfs.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(emailsWithPdfs.map((e) => e.id)));
    }
  };

  const handleBatchProcess = async () => {
    if (selectedEmails.size === 0) {
      alert("Please select at least one email to process");
      return;
    }

    setIsBatchProcessing(true);
    setError(null);

    const emailIds = Array.from(selectedEmails);
    let successCount = 0;
    let failCount = 0;
    let totalWorkOrders = 0;
    let allNewWorkOrders: ParsedWorkOrder[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    for (const messageId of emailIds) {
      try {
        setIsProcessing(messageId);
        
        // Set headers for plan
        // Note: Free plan users should NOT use server routes (Gmail is Pro/Premium feature)
        // Pro/Premium users use server-side key (no BYOK sent)
        const headers: HeadersInit = {
          "Content-Type": "application/json",
          "x-plan": plan,
        };
        
        // Free plan: BYOK should NOT be sent to server (client-side only)
        // Pro/Premium: Server uses env var, no key needed from client
        
        const response = await fetch("/api/gmail/process", {
          method: "POST",
          headers,
          body: JSON.stringify({
            messageId,
            autoRemoveLabel,
          }),
        });

        if (!response.ok) {
          failCount++;
          continue;
        }

        const processData: ManualProcessResponse = await response.json();
        const newWorkOrders = processData.workOrders || [];
        
        console.log(`[Batch Process] Email ${messageId}: Received ${newWorkOrders.length} work order(s)`, {
          workOrders: newWorkOrders,
          meta: processData.meta,
        });
        
        if (newWorkOrders.length > 0) {
          allNewWorkOrders.push(...newWorkOrders);
          totalWorkOrders += newWorkOrders.length;
        } else {
          console.warn(`[Batch Process] Email ${messageId}: No work orders extracted. Check API logs for details.`);
        }

        // Accumulate token usage
        if (processData.meta.tokenUsage) {
          totalPromptTokens += processData.meta.tokenUsage.promptTokens;
          totalCompletionTokens += processData.meta.tokenUsage.completionTokens;
          totalTokens += processData.meta.tokenUsage.totalTokens;
        }

        // Update email list if label was removed
        if (autoRemoveLabel && processData.meta.labelRemoved) {
          setEmails((prev) => prev.filter((e) => e.id !== messageId));
        }

        successCount++;
      } catch (error) {
        console.error(`Error processing email ${messageId}:`, error);
        failCount++;
      } finally {
        setIsProcessing(null);
      }
    }

    // Update accumulated work orders in one batch (with deduplication)
    console.log(`[Batch Process] Total new work orders to add: ${allNewWorkOrders.length}`);
    if (allNewWorkOrders.length > 0) {
      setAccumulatedWorkOrders((prev) => {
        const deduplicated = deduplicateWorkOrders(prev, allNewWorkOrders);
        const duplicatesSkipped = prev.length + allNewWorkOrders.length - deduplicated.length;
        console.log(`[Batch Process] Updated accumulated work orders: ${prev.length} -> ${deduplicated.length} (${duplicatesSkipped} duplicate(s) skipped)`);
        return deduplicated;
      });
    } else {
      console.warn(`[Batch Process] No work orders to accumulate. All ${successCount} emails processed but extracted 0 work orders.`);
    }

    // Update token usage in localStorage
    if (totalTokens > 0) {
      const stored = localStorage.getItem("tokenUsage");
      const current = stored ? JSON.parse(stored) : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const updated = {
        promptTokens: current.promptTokens + totalPromptTokens,
        completionTokens: current.completionTokens + totalCompletionTokens,
        totalTokens: current.totalTokens + totalTokens,
      };
      localStorage.setItem("tokenUsage", JSON.stringify(updated));
      // Trigger storage event to update settings page if open
      window.dispatchEvent(new Event("storage"));
    }

    setIsBatchProcessing(false);
    setSelectedEmails(new Set());

    const finalTotal = accumulatedWorkOrders.length + totalWorkOrders;
    alert(
      `Batch processing complete!\n` +
      `✅ Successfully processed: ${successCount} email(s)\n` +
      `❌ Failed: ${failCount} email(s)\n` +
      `📄 Total work orders extracted: ${totalWorkOrders}\n` +
      `📊 Total in session: ${finalTotal}`
    );
  };

  // Hide Pro features (Gmail import) if not available and dev override is off
  // Note: Free users are handled above with immediate redirect
  if (!canUseGmail && !canUsePro) {
    // Pro/Premium users without Gmail: show upgrade message (shouldn't happen normally)
    return (
      <AppShell>
        <MainNavigation currentMode="gmail" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h2 className="text-lg font-semibold text-yellow-300">Gmail Import Not Available</h2>
            </div>
            <p className="text-yellow-200 mb-4">
              Gmail import is only available on Pro and Premium plans. Please upgrade to access this feature.
            </p>
            <button
              onClick={() => {
                alert("Upgrade functionality coming soon!");
              }}
              className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 font-medium"
            >
              Upgrade to Pro
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  // Hide Pro features (Gmail import) if not available and dev override is off
  if (!canUseGmail && !canUsePro) {
    return null; // Don't render Gmail UI for Free users in production
  }

  return (
    <AppShell>
      <MainNavigation currentMode="gmail" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          {/* Page Title */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">
              From Inbox
            </h1>
            <p className="text-sm text-gray-400">
              Shows emails with the "{WORK_ORDER_LABEL_NAME}" label. Process to extract work orders.
            </p>
          </div>

          {/* Spreadsheet ID Warning - Only show for Pro/Premium users */}
          {canUseGmail && hasSpreadsheetId === false && (
            <div className="mb-6 bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 mt-0.5 flex-shrink-0 text-yellow-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div className="flex-1">
                  <h3 className="text-yellow-300 font-medium mb-1">
                    Google Sheets Not Configured
                  </h3>
                  <p className="text-yellow-200 text-sm mb-2">
                    To save work orders to Google Sheets, please configure your spreadsheet ID in Settings.
                  </p>
                  <a
                    href="/settings"
                    className="inline-flex items-center gap-1 text-yellow-300 hover:text-yellow-200 text-sm font-medium underline"
                  >
                    Go to Settings
                    <svg
                      className="w-4 h-4"
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
                  </a>
                </div>
              </div>
            </div>
          )}

        <div className="space-y-6">
          {/* Header and Controls */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                {/* Title moved to top */}
              </div>
              <button
                onClick={handleFindEmails}
                disabled={isLoadingEmails}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isLoadingEmails ? "Loading..." : "Find Work Orders in Gmail"}
              </button>
            </div>

            {/* Controls Row */}
            <div className="flex items-center gap-6">
              {/* Auto-remove label toggle */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-300">Auto-remove label:</span>
                <button
                  type="button"
                  onClick={() => setAutoRemoveLabel((prev) => !prev)}
                  className={`px-3 py-1.5 rounded font-medium text-sm transition-colors ${
                    autoRemoveLabel
                      ? "bg-green-600 text-white hover:bg-green-700"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {autoRemoveLabel ? "On" : "Off"}
                </button>
              </div>

              {/* Gmail Label Filter */}
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <label className="text-sm text-gray-300 whitespace-nowrap">Filter by label:</label>
                <input
                  type="text"
                  value={gmailLabel}
                  onChange={(e) => setGmailLabel(e.target.value)}
                  placeholder="e.g., WorkOrders, INBOX"
                  className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
            </div>
          </div>

          {/* Email List Section */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">

            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">
                {error}
              </div>
            )}

            {emails.length > 0 && (
              <div className="space-y-4">
                {/* Batch Actions */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSelectAll}
                      className="px-3 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-sm font-medium"
                    >
                      {selectedEmails.size === emails.filter((e) => e.attachmentCount > 0).length
                        ? "Deselect All"
                        : "Select All"}
                    </button>
                    {selectedEmails.size > 0 && (
                      <button
                        onClick={handleBatchProcess}
                        disabled={isBatchProcessing}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                      >
                        {isBatchProcessing
                          ? `Processing ${selectedEmails.size}...`
                          : `Process Selected (${selectedEmails.size})`}
                      </button>
                    )}
                  </div>
                  <span className="text-sm text-gray-400">
                    {selectedEmails.size} selected
                  </span>
                </div>

                {/* Email Table */}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-700">
                    <thead className="bg-gray-700">
                      <tr>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-10">
                          <input
                            type="checkbox"
                            checked={
                              emails.filter((e) => e.attachmentCount > 0).length > 0 &&
                              selectedEmails.size === emails.filter((e) => e.attachmentCount > 0).length
                            }
                            onChange={handleSelectAll}
                            className="rounded border-gray-600 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="px-2 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-16">
                          {/* Expander */}
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-24">
                          Status
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
                      </tr>
                    </thead>
                  <tbody className="bg-gray-800 divide-y divide-gray-700">
                    {emails.map((email) => {
                      const isExpanded = expandedEmails.has(email.id);
                      return (
                        <React.Fragment key={email.id}>
                          <tr
                            className={`hover:bg-gray-750 cursor-pointer ${
                              selectedEmails.has(email.id) ? "bg-gray-700/50" : ""
                            }`}
                            onClick={() => handleToggleExpandEmail(email.id)}
                          >
                            <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedEmails.has(email.id)}
                                onChange={() => handleToggleSelectEmail(email.id)}
                                disabled={email.attachmentCount === 0}
                                className="rounded border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-30"
                              />
                            </td>
                            <td className="px-2 py-3">
                              <svg
                                className={`w-4 h-4 text-gray-400 transition-transform ${
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
                            </td>
                            <td className="px-3 py-3">
                              {email.attachmentCount > 0 ? (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/50 text-green-300 whitespace-nowrap">
                                  {email.attachmentCount} PDF(s)
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-400 whitespace-nowrap">
                                  No PDFs
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-sm font-medium text-white truncate">
                              {email.subject || "(No subject)"}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-300 whitespace-nowrap">
                              {email.date ? new Date(email.date).toLocaleDateString() : "-"}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-300 text-center">
                              {email.attachmentCount}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-gray-750/50">
                              <td colSpan={6} className="px-4 py-4">
                                <div className="space-y-3 text-sm">
                                  <div>
                                    <span className="font-medium text-gray-300">Subject:</span>
                                    <span className="ml-2 text-white">{email.subject || "(No subject)"}</span>
                                  </div>
                                  <div>
                                    <span className="font-medium text-gray-300">From:</span>
                                    <span className="ml-2 text-white">{email.from}</span>
                                  </div>
                                  <div>
                                    <span className="font-medium text-gray-300">Date:</span>
                                    <span className="ml-2 text-white">
                                      {email.date
                                        ? new Date(email.date).toLocaleString()
                                        : "-"}
                                    </span>
                                  </div>
                                  {email.threadId && (
                                    <div>
                                      <span className="font-medium text-gray-300">Thread ID:</span>
                                      <span className="ml-2 text-white font-mono text-xs">
                                        {email.threadId}
                                      </span>
                                    </div>
                                  )}
                                  {email.snippet && (
                                    <div>
                                      <span className="font-medium text-gray-300">Preview:</span>
                                      <p className="mt-1 text-gray-400 whitespace-pre-wrap">
                                        {email.snippet}
                                      </p>
                                    </div>
                                  )}
                                  <div>
                                    <span className="font-medium text-gray-300">PDF Attachments:</span>
                                    <span className="ml-2 text-white">{email.attachmentCount}</span>
                                  </div>
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
              </div>
            )}

            {emails.length === 0 && !isLoadingEmails && (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">
                  Click "Find Work Orders in Gmail" to search for emails with PDF attachments.
                </p>
              </div>
            )}
          </div>

          {/* Parsed Work Orders Preview */}
          {accumulatedWorkOrders.length > 0 && (
            <ParsedWorkOrdersPreview
              workOrders={accumulatedWorkOrders}
              onClear={() => {
                setAccumulatedWorkOrders([]);
              }}
              onRemove={(index) => {
                setAccumulatedWorkOrders((prev) => prev.filter((_, i) => i !== index));
              }}
            />
          )}

          {/* Tip */}
          {accumulatedWorkOrders.length > 0 && (
            <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
              <p className="text-sm text-blue-200">
                💡 <strong>Tip:</strong> Click "Download CSV" and upload to your own Google Sheet. This app does not store your work orders.
              </p>
            </div>
          )}
        </div>
        </div>
      </div>
    </AppShell>
  );
}
