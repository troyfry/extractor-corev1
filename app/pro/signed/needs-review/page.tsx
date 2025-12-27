"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import { getNeedsReviewUx } from "@/lib/workOrders/reviewReasons";

type NeedsReviewItem = {
  review_id: string | null;
  created_at: string | null;
  fmKey: string | null;
  signed_pdf_url: string | null;
  preview_image_url: string | null;
  raw_text: string | null;
  confidence: string | null;
  reason: string | null;
  manual_work_order_number: string | null;
  resolved: string | null;
  resolved_at: string | null;
  reason_note: string | null;
};

// Helper to get tone border class
function getToneBorderClass(tone: string | null | undefined): string {
  switch (tone) {
    case "warning":
      return "border-amber-500";
    case "danger":
      return "border-red-500";
    case "info":
      return "border-slate-500";
    case "success":
      return "border-green-500";
    default:
      return "border-gray-700";
  }
}

export default function NeedsReviewPage() {
  const [items, setItems] = useState<NeedsReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<NeedsReviewItem | null>(null);
  const [woNumber, setWoNumber] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveSuccess, setResolveSuccess] = useState(false);
  const [filterFmKey, setFilterFmKey] = useState("");
  const [filterReason, setFilterReason] = useState("");
  const [showOnlyUnresolved, setShowOnlyUnresolved] = useState(true);
  const [showFixModal, setShowFixModal] = useState(false);
  const [selectedFixItem, setSelectedFixItem] = useState<{ item: NeedsReviewItem; ux: ReturnType<typeof getNeedsReviewUx> } | null>(null);

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/signed/needs-review");
      if (!response.ok) {
        throw new Error("Failed to load needs review items");
      }
      const data = await response.json();
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }

  function handleResolveClick(item: NeedsReviewItem) {
    setSelectedItem(item);
    setWoNumber(item.manual_work_order_number || "");
    setReasonNote("");
    setResolveError(null);
    setResolveSuccess(false);
    setShowModal(true);
  }

  function handleFixClick(item: NeedsReviewItem) {
    const reason = item.reason || "";
    const ux = getNeedsReviewUx(reason, item.fmKey || undefined);
    setSelectedFixItem({ item, ux });
    setShowFixModal(true);
  }

  function handleOpenTemplates() {
    if (selectedFixItem?.ux.href) {
      window.open(selectedFixItem.ux.href, "_blank", "noopener,noreferrer");
    }
  }

  function handleRetryAfterFix() {
    // For now, instruct user to re-upload
    // TODO: Implement /api/signed/retry endpoint
    alert("Please re-upload the signed PDF after fixing the template. The retry feature will be available soon.");
    setShowFixModal(false);
  }

  async function handleResolveSubmit() {
    if (!selectedItem || !woNumber.trim()) {
      setResolveError("Work order number is required");
      return;
    }

    try {
      setResolvingId(selectedItem.review_id);
      setResolveError(null);
      setResolveSuccess(false);

      const response = await fetch("/api/signed/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewRowId: selectedItem.review_id,
          fmKey: selectedItem.fmKey || "",
          woNumber: woNumber.trim(),
          reasonNote: reasonNote.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to resolve");
      }

      const data = await response.json();

      if (data.mode === "UPDATED") {
        setResolveSuccess(true);
        setTimeout(() => {
          setShowModal(false);
          loadItems(); // Refresh list
        }, 1500);
      } else if (data.mode === "NEEDS_REVIEW" && data.data?.reason === "no_matching_job_row") {
        setResolveError(
          "No matching job found in Sheet1. Add this work order to Sheet1 first, then you can resolve it."
        );
      } else {
        throw new Error("Unexpected response");
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setResolvingId(null);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="p-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <p className="mt-4 text-sm text-gray-400">Loading needs review items...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <MainNavigation />
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-6">Needs Review - Signed Work Orders</h1>

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded text-red-300">
            {error}
          </div>
        )}

        {items.length === 0 ? (
          <div className="p-8 bg-gray-800 rounded border border-gray-700 text-center">
            <p className="text-gray-400">No items need review.</p>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div className="mb-4 p-4 bg-gray-800 rounded border border-gray-700 flex gap-4 items-center flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-300">FM Key:</label>
                <select
                  value={filterFmKey}
                  onChange={(e) => setFilterFmKey(e.target.value)}
                  className="px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                >
                  <option value="">All</option>
                  {Array.from(new Set(items.map(i => i.fmKey).filter(Boolean)) as Set<string>)
                    .sort()
                    .map((fmKey) => (
                      <option key={fmKey} value={fmKey}>{fmKey}</option>
                    ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-300">Reason:</label>
                <select
                  value={filterReason}
                  onChange={(e) => setFilterReason(e.target.value)}
                  className="px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                >
                  <option value="">All</option>
                  {Array.from(new Set(items.map(i => i.reason).filter(Boolean)) as Set<string>)
                    .sort()
                    .map((reason) => (
                      <option key={reason} value={reason}>{reason}</option>
                    ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="showOnlyUnresolved"
                  checked={showOnlyUnresolved}
                  onChange={(e) => setShowOnlyUnresolved(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="showOnlyUnresolved" className="text-sm text-gray-300">
                  Show only unresolved
                </label>
              </div>
            </div>

            {/* Filtered items */}
            {(() => {
              const filteredItems = items.filter(i => {
                if (showOnlyUnresolved && String(i.resolved).toUpperCase() === "TRUE") return false;
                if (filterFmKey && i.fmKey !== filterFmKey) return false;
                if (filterReason && i.reason !== filterReason) return false;
                return true;
              });

              if (filteredItems.length === 0) {
                return (
                  <div className="p-8 bg-gray-800 rounded border border-gray-700 text-center">
                    <p className="text-gray-400">No items match the filters.</p>
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">FM Key</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">Reason</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">Next Step</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">Fix</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">Evidence</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">WO #</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">Confidence</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">Code</th>
                  <th className="text-left p-3 text-sm font-semibold text-gray-300">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, index) => {
                  const reason = item.reason || "";
                  const ux = getNeedsReviewUx(reason, item.fmKey || undefined);
                  const borderClass = getToneBorderClass(ux.tone);

                  return (
                    <tr key={item.review_id ?? `${item.fmKey ?? "unknown"}-${item.created_at ?? "na"}-${index}`}
                      className={`bg-gray-800 border-l-2 ${borderClass} hover:bg-gray-700/50 transition-colors`}
                    >
                      <td className="p-3 text-sm text-gray-300">
                        {item.fmKey || "Unknown"}
                      </td>
                      <td className="p-3">
                        <div>
                          <div className="text-sm font-semibold text-gray-200 mb-1">
                            {ux.title}
                          </div>
                          <div className="text-xs text-gray-400">
                            {ux.message}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-gray-300">
                        {ux.actionLabel || "—"}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          {ux.href && (
                            <button
                              onClick={() => handleFixClick(item)}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
                            >
                              {ux.actionLabel || "Fix"}
                            </button>
                          )}
                          <button
                            onClick={() => handleResolveClick(item)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
                          >
                            Resolve
                          </button>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          {item.signed_pdf_url ? (
                            <a
                              href={item.signed_pdf_url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors"
                            >
                              Open PDF
                            </a>
                          ) : (
                            <span className="text-xs text-gray-500">No PDF</span>
                          )}

                          {item.preview_image_url ? (
                            <a
                              href={item.preview_image_url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors"
                            >
                              Snippet
                            </a>
                          ) : (
                            <span className="text-xs text-gray-500">No snippet</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-sm text-gray-300">
                        {item.manual_work_order_number || "—"}
                      </td>
                      <td className="p-3 text-sm text-gray-300">
                        {item.confidence || "—"}
                      </td>
                      <td className="p-3 text-xs text-gray-500 font-mono">
                        {item.reason || "—"}
                      </td>
                      <td className="p-3 text-xs text-gray-500">
                        {item.created_at
                          ? new Date(item.created_at).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>
        )}

        {/* Fix Modal */}
        {showFixModal && selectedFixItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold text-white mb-4">Fix Template</h2>

              <div className="space-y-4">
                <div>
                  <div className="text-sm font-semibold text-gray-200 mb-1">
                    {selectedFixItem.ux.title}
                  </div>
                  <div className="text-sm text-gray-400 mb-3">
                    {selectedFixItem.ux.message}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    FM Key
                  </label>
                  <div className="text-sm text-gray-400">
                    {selectedFixItem.item.fmKey || "Unknown"}
                  </div>
                </div>

                <div className="flex gap-3 justify-end pt-4 border-t border-gray-700">
                  <button
                    onClick={() => setShowFixModal(false)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleOpenTemplates}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                  >
                    Open Templates
                  </button>
                  <button
                    onClick={handleRetryAfterFix}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
                  >
                    I fixed it — retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Resolve Modal */}
        {showModal && selectedItem && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold text-white mb-4">Resolve Work Order</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Work Order Number *
                  </label>
                  <input
                    type="text"
                    value={woNumber}
                    onChange={(e) => setWoNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                    placeholder="Enter work order number"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Note (optional)
                  </label>
                  <textarea
                    value={reasonNote}
                    onChange={(e) => setReasonNote(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
                    rows={3}
                    placeholder="Add any notes about this resolution..."
                  />
                </div>

                {resolveError && (
                  <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
                    {resolveError}
                  </div>
                )}

                {resolveSuccess && (
                  <div className="p-3 bg-green-900/30 border border-green-700 rounded text-green-300 text-sm">
                    ✓ Successfully resolved and updated to SIGNED status
                  </div>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                    disabled={resolvingId !== null}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleResolveSubmit}
                    disabled={resolvingId !== null || !woNumber.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded"
                  >
                    {resolvingId ? "Resolving..." : "Resolve"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

