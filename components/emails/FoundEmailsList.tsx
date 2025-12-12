"use client";

import React, { useState, useEffect } from "react";
import type { EmailMessage, EmailProcessingStatus } from "@/lib/emailMessages/types";

export default function FoundEmailsList() {
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [processingEmails, setProcessingEmails] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch email messages on mount
  useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch only "new" status emails by default
        const response = await fetch("/api/email-messages?limit=50&status=new");
        if (!response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Failed to fetch email messages");
          } else {
            throw new Error(`Failed to fetch email messages: ${response.status} ${response.statusText}`);
          }
        }
        const data = await response.json();
        setMessages(data.emailMessages || []);
        setHasMore(data.hasMore || false);
      } catch (err) {
        console.error("Error fetching email messages:", err);
        setError(err instanceof Error ? err.message : "Failed to load emails");
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, []);

  // Load more emails
  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;

    setLoadingMore(true);
    try {
      // Use the last message's receivedAt as cursor
      const lastMessage = messages[messages.length - 1];
      const cursor = new Date(lastMessage.receivedAt).toISOString();
      
      const response = await fetch(
        `/api/email-messages?limit=50&cursor=${encodeURIComponent(cursor)}`
      );
      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to load more emails");
        } else {
          throw new Error(`Failed to load more emails: ${response.status} ${response.statusText}`);
        }
      }
      const data = await response.json();
      setMessages((prev) => [...prev, ...(data.emailMessages || [])]);
      setHasMore(data.hasMore || false);
    } catch (err) {
      console.error("Error loading more emails:", err);
      alert("Failed to load more emails. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleExpand = (emailId: string) => {
    const newExpanded = new Set(expandedEmails);
    if (newExpanded.has(emailId)) {
      newExpanded.delete(emailId);
    } else {
      newExpanded.add(emailId);
    }
    setExpandedEmails(newExpanded);
  };

  const toggleSelect = (emailId: string) => {
    const newSelected = new Set(selectedEmails);
    if (newSelected.has(emailId)) {
      newSelected.delete(emailId);
    } else {
      newSelected.add(emailId);
    }
    setSelectedEmails(newSelected);
  };

  const selectAll = () => {
    if (selectedEmails.size === messages.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(messages.map((m) => m.id)));
    }
  };

  const handleProcessEmail = async (emailId: string) => {
    setProcessingEmails((prev) => new Set(prev).add(emailId));
    try {
      const response = await fetch(`/api/email-messages/${emailId}/process`, {
        method: "POST",
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to process email");
        } else {
          throw new Error(`Failed to process email: ${response.status} ${response.statusText}`);
        }
      }

      const data = await response.json();
      // Update the message in local state with the updated email message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === emailId ? data.emailMessage : msg
        )
      );

      // Show feedback about created work orders or duplicates
      if (data.createdWorkOrders && data.createdWorkOrders.length > 0) {
        console.log(
          `Created ${data.createdWorkOrders.length} work order(s) from email`
        );
      }
      if (
        data.duplicateWorkOrderNumbers &&
        data.duplicateWorkOrderNumbers.length > 0
      ) {
        console.log(
          `Skipped duplicate work orders: ${data.duplicateWorkOrderNumbers.join(", ")}`
        );
      }
    } catch (err) {
      console.error("Error processing email:", err);
      alert("Failed to process email. Please try again.");
    } finally {
      setProcessingEmails((prev) => {
        const next = new Set(prev);
        next.delete(emailId);
        return next;
      });
    }
  };

  const handleBatchProcess = async () => {
    const toProcess = Array.from(selectedEmails).filter((id) => {
      const msg = messages.find((m) => m.id === id);
      return msg && msg.processingStatus === "new";
    });

    if (toProcess.length === 0) {
      return;
    }

    setProcessingEmails(new Set(toProcess));

    try {
      // Process all selected emails
      const promises = toProcess.map((id) =>
        fetch(`/api/email-messages/${id}/process`, { method: "POST" })
      );

      const results = await Promise.allSettled(promises);

      // Refresh the list
      const response = await fetch("/api/email-messages?limit=50&status=new");
      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const data = await response.json();
          setMessages(data.emailMessages || []);
          setHasMore(data.hasMore || false);
        } else {
          console.error("Received non-JSON response when refreshing email list");
        }
      }
    } catch (err) {
      console.error("Error batch processing emails:", err);
      alert("Some emails failed to process. Please try again.");
    } finally {
      setProcessingEmails(new Set());
      setSelectedEmails(new Set());
    }
  };

  const handleClearList = async () => {
    if (!confirm("Are you sure you want to clear all email messages? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch("/api/email-messages", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to clear email messages");
      }

      // Clear the local state
      setMessages([]);
      setHasMore(false);
      setSelectedEmails(new Set());
      alert("All email messages have been cleared.");
    } catch (err) {
      console.error("Error clearing email messages:", err);
      alert("Failed to clear email messages. Please try again.");
    }
  };

  // Extract work order number from subject (look for WO# pattern)
  const extractWorkOrderNumber = (subject: string): string | null => {
    const match = subject.match(/WO#?\s*(\d+)/i);
    return match ? match[1] : null;
  };

  // Map EmailProcessingStatus to UI status
  const getUIStatus = (msg: EmailMessage): "ALREADY EXISTS" | "PROCESSED" | "NEW" => {
    if (msg.processingStatus === "processed") {
      return "PROCESSED";
    }
    if (msg.processingStatus === "skipped_duplicate" || msg.duplicateOfWorkOrderId) {
      return "ALREADY EXISTS";
    }
    return "NEW";
  };

  const getStatusBadge = (status: "ALREADY EXISTS" | "PROCESSED" | "NEW") => {
    switch (status) {
      case "ALREADY EXISTS":
        return (
          <span className="inline-flex items-center gap-1 text-yellow-400 text-xs font-medium">
            <svg
              className="w-4 h-4"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            [! ALREADY EXISTS]
          </span>
        );
      case "PROCESSED":
        return (
          <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
            <svg
              className="w-4 h-4"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            [✓ PROCESSED]
          </span>
        );
      case "NEW":
        return (
          <span className="inline-flex items-center gap-1 text-blue-400 text-xs font-medium">
            <svg
              className="w-4 h-4"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                clipRule="evenodd"
              />
            </svg>
            [NEW]
          </span>
        );
    }
  };

  const getStatusAlert = (msg: EmailMessage) => {
    const uiStatus = getUIStatus(msg);
    const workOrderNumber = extractWorkOrderNumber(msg.subject);

    if (uiStatus === "ALREADY EXISTS" && (workOrderNumber || msg.duplicateOfWorkOrderId)) {
      return (
        <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded flex items-start gap-3">
          <div className="flex items-center gap-2 text-yellow-400">
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-semibold text-sm">EXISTS</span>
          </div>
          <p className="text-sm text-gray-300 flex-1">
            Work order {workOrderNumber || "already exists"} already exists in the sheet. Will be skipped if processed (see Settings).
          </p>
        </div>
      );
    }
    if (uiStatus === "PROCESSED") {
      return (
        <div className="mt-4 p-3 bg-green-900/30 border border-green-700/50 rounded flex items-start gap-3">
          <div className="flex items-center gap-2 text-green-400">
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-semibold text-sm">PROCESSED</span>
          </div>
          <p className="text-sm text-gray-300 flex-1">
            This email has been processed and work order(s) added to the system.
          </p>
        </div>
      );
    }
    return null;
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  // Parse from address to get name and email
  const parseFromAddress = (fromAddress: string) => {
    // Try to parse "Name <email@domain.com>" format
    const match = fromAddress.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    // If no name, just return email
    return { name: "", email: fromAddress.trim() };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 flex items-center justify-center">
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
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-white">Found Emails</h1>
          </div>
        </div>
        <div className="text-center py-12 text-gray-400">
          <p>Loading emails...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 flex items-center justify-center">
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
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-white">Found Emails</h1>
          </div>
        </div>
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center">
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
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-white">Found Emails</h1>
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleClearList}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Batch Actions */}
      {messages.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedEmails.size === messages.length && messages.length > 0}
                onChange={selectAll}
                className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-300">
                Select All ({selectedEmails.size} selected)
              </span>
            </label>
          </div>
          {selectedEmails.size > 0 && (
            <button
              onClick={handleBatchProcess}
              disabled={processingEmails.size > 0}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {processingEmails.size > 0 ? "Processing..." : `Process Selected (${selectedEmails.size})`}
            </button>
          )}
        </div>
      )}

      {/* Email List */}
      <div className="space-y-3">
        {messages.map((msg) => {
          const isExpanded = expandedEmails.has(msg.id);
          const isSelected = selectedEmails.has(msg.id);
          const isProcessing = processingEmails.has(msg.id);
          const uiStatus = getUIStatus(msg);
          const fromInfo = parseFromAddress(msg.fromAddress);
          const workOrderNumber = extractWorkOrderNumber(msg.subject);

          return (
            <div
              key={msg.id}
              className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden"
            >
              {/* Email Summary Row */}
              <div className="flex items-start gap-3 p-4">
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(msg.id)}
                  className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                />

                {/* Expand/Collapse Arrow */}
                <button
                  onClick={() => toggleExpand(msg.id)}
                  className="mt-0.5 text-gray-400 hover:text-white transition-colors"
                >
                  <svg
                    className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
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
                </button>

                {/* Status Badge */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusBadge(uiStatus)}
                    {/* PDF Icon */}
                    {msg.hasPdfAttachments && (
                      <svg
                        className="w-4 h-4 text-purple-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                  <div className="text-sm text-gray-300">
                    <span className="font-medium">{msg.subject.substring(0, 60)}{msg.subject.length > 60 ? "..." : ""}</span> | From: {fromInfo.name || fromInfo.email} {fromInfo.name ? `<${fromInfo.email}>` : ""} | Date: {formatDate(msg.receivedAt)} | PDFs: {msg.pdfAttachmentCount}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-700 pt-4">
                  <div className="space-y-2 text-sm text-gray-300 mb-4">
                    <div>
                      <span className="font-medium">Subject:</span> {msg.subject}
                    </div>
                    <div>
                      <span className="font-medium">From:</span> {msg.fromAddress}
                    </div>
                    <div>
                      <span className="font-medium">To:</span> {msg.toAddress}
                    </div>
                    <div>
                      <span className="font-medium">Date:</span> {new Date(msg.receivedAt).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">PDF Attachments:</span> {msg.pdfAttachmentCount}
                    </div>
                    {msg.attachments.length > 0 && (
                      <div>
                        <span className="font-medium">All Attachments:</span> {msg.attachments.map((a) => a.filename).join(", ")}
                      </div>
                    )}
                  </div>

                  {/* Status Alert */}
                  {getStatusAlert(msg)}

                  {/* Process Button */}
                  <button
                    onClick={() => handleProcessEmail(msg.id)}
                    disabled={
                      isProcessing ||
                      uiStatus === "PROCESSED" ||
                      uiStatus === "ALREADY EXISTS"
                    }
                    className="mt-4 w-full px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    {isProcessing
                      ? "Processing..."
                      : uiStatus === "PROCESSED"
                      ? "Already Processed"
                      : uiStatus === "ALREADY EXISTS"
                      ? "Already Exists"
                      : "Process this email"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load More Button */}
      {messages.length > 0 && hasMore && (
        <div className="flex justify-center py-6">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {/* Empty State */}
      {messages.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">
          <p>No emails found</p>
          <p className="text-sm mt-2">Emails will appear here when they are received via the inbound email endpoint.</p>
        </div>
      )}
    </div>
  );
}

