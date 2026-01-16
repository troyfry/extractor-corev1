"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import { getNeedsReviewUx } from "@/lib/workOrders/reviewReasons";
import { ROUTES } from "@/lib/routes";
import Link from "next/link";

type NeedsReviewItem = {
  review_id: string | null;
  created_at: string | null;
  fmKey: string | null;
  signed_pdf_url: string | null;
  preview_image_url: string | null;
  snippet_url?: string | null; // Snippet image URL
  raw_text: string | null;
  confidence: string | null;
  reason: string | null;
  manual_work_order_number: string | null;
  resolved: string | null;
  resolved_at: string | null;
  reason_note: string | null;
  // 3-layer extraction fields
  extraction_method?: string | null;
  extraction_confidence?: string | null;
  extraction_rationale?: string | null;
  extracted_work_order_number?: string | null;
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
  const [filterFmKey, setFilterFmKey] = useState("");
  const [filterReason, setFilterReason] = useState("");

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/signed/needs-review");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to load verification items" }));
        if (errorData.code === "DB_UNAVAILABLE") {
          throw new Error(`Database unavailable: ${errorData.error || "Service temporarily unavailable"}`);
        }
        throw new Error(errorData.error || "Failed to load verification items");
      }
      const data = await response.json();
      const items = data.items || [];
      // Log first item to debug field names
      if (items.length > 0) {
        console.log("[Needs Review] Sample item fields:", Object.keys(items[0]));
        console.log("[Needs Review] Sample item fmKey:", items[0].fmKey, items[0].fmkey, items[0].FMKey);
      }
      setItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }

  async function handleResolveSubmit() {
    if (!selectedItem || !woNumber.trim()) {
      setResolveError("Please enter a work order number");
      return;
    }

    // Validate required fields
    if (!selectedItem.review_id) {
      setResolveError("Review ID is missing. Please refresh the page and try again.");
      return;
    }

    if (!selectedItem.fmKey || !selectedItem.fmKey.trim()) {
      setResolveError("FM Key is missing. Please refresh the page and try again.");
      return;
    }

    try {
      setResolvingId(selectedItem.review_id || null);
      setResolveError(null);

      const requestBody = {
        reviewRowId: selectedItem.review_id,
        fmKey: selectedItem.fmKey.trim(),
        woNumber: woNumber.trim(),
        reasonNote: reasonNote.trim() || undefined,
      };

      console.log("[Needs Review] Resolve request:", requestBody);

      const response = await fetch("/api/signed/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json();
        if (response.status === 410 && data.code === "LEGACY_DISABLED") {
          throw new Error("Legacy write endpoint disabled. This workspace is using DB Native Mode. Please contact support.");
        }
        throw new Error(data.error || "Failed to resolve");
      }

      // Reload items
      await loadItems();
      setShowModal(false);
      setWoNumber("");
      setReasonNote("");
      setSelectedItem(null);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setResolvingId(null);
    }
  }

  function handleResolveClick(item: NeedsReviewItem) {
    console.log("[Needs Review] Selected item:", {
      review_id: item.review_id,
      fmKey: item.fmKey,
      allKeys: Object.keys(item),
    });
    setSelectedItem(item);
    setWoNumber(item.manual_work_order_number || "");
    setReasonNote(item.reason_note || "");
    setResolveError(null);
    setShowModal(true);
  }

  if (loading) {
    return (
      <AppShell>
        <MainNavigation currentMode="signed" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              <p className="mt-4 text-sm text-gray-400">Loading verification items...</p>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error) {
    const isDbError = error.includes("Database unavailable") || error.includes("DB_UNAVAILABLE");
    
    return (
      <AppShell>
        <MainNavigation currentMode="signed" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center py-12">
              {isDbError ? (
                <>
                  <div className="text-4xl mb-2">⚠️</div>
                  <p className="text-red-400 text-lg font-semibold mb-2">Database Unavailable</p>
                  <p className="text-gray-400 text-sm mb-4">
                    The database is currently unavailable. Please try again in a moment.
                  </p>
                  <button
                    onClick={() => {
                      setError(null);
                      setLoading(true);
                      loadItems();
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Retry
                  </button>
                </>
              ) : (
                <>
                  <p className="text-red-400 mb-4">{error}</p>
                  <button
                    onClick={() => {
                      setError(null);
                      setLoading(true);
                      loadItems();
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Retry
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const filteredItems = items.filter((i) => {
    if (filterFmKey && i.fmKey !== filterFmKey) return false;
    if (filterReason && i.reason !== filterReason) return false;
    return true;
  });

  return (
    <AppShell>
      <MainNavigation currentMode="signed" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-white mb-2">
                  Needs Review
                </h1>
                <p className="text-sm text-gray-400">
                  Verify and resolve signed work orders that require attention.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href={ROUTES.signed}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors text-sm"
                >
                  ← Back to Signed
                </Link>
                <Link
                  href={ROUTES.workOrders}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors text-sm"
                >
                  Work Orders →
                </Link>
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="p-8 bg-gray-800 rounded border border-gray-700 text-center">
              <p className="text-gray-400">No items need verification.</p>
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
                    {Array.from(new Set(items.map((i) => i.fmKey).filter(Boolean)) as Set<string>)
                      .sort()
                      .map((fmKey) => (
                        <option key={fmKey} value={fmKey}>
                          {fmKey}
                        </option>
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
                    {Array.from(new Set(items.map((i) => i.reason).filter(Boolean)) as Set<string>)
                      .sort()
                      .map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Items List */}
              {filteredItems.length === 0 ? (
                <div className="p-8 bg-gray-800 rounded border border-gray-700 text-center">
                  <p className="text-gray-400">No items match the filters.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredItems.map((item, index) => {
                    const reason = item.reason || "";
                    const ux = getNeedsReviewUx(reason, item.fmKey || undefined);
                    const borderClass = getToneBorderClass(ux.tone);

                    return (
                      <div
                        key={item.review_id ?? `${item.fmKey ?? "unknown"}-${item.created_at ?? "na"}-${index}`}
                        className={`bg-gray-800 rounded-lg border-l-4 ${borderClass} p-4`}
                      >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <div className="text-sm font-semibold text-gray-200 mb-1">
                              {ux.title}
                            </div>
                            <div className="text-xs text-gray-400 mb-2">
                              {ux.message}
                            </div>
                            <div className="text-xs text-gray-500">
                              <div>FM Key: {item.fmKey || "Unknown"}</div>
                              <div>Reason: {item.reason || "—"}</div>
                              {item.confidence && <div>Confidence: {item.confidence}</div>}
                              {/* 3-layer extraction details */}
                              {item.extraction_method && (
                                <div className="mt-2 pt-2 border-t border-gray-700">
                                  <div className="text-xs font-semibold text-gray-400 mb-1">Extraction:</div>
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded text-xs">
                                      {item.extraction_method}
                                    </span>
                                    {item.extraction_confidence && (
                                      <span className="text-gray-400">
                                        {Math.round(parseFloat(item.extraction_confidence) * 100)}%
                                      </span>
                                    )}
                                  </div>
                                  {item.extracted_work_order_number && (
                                    <div className="text-gray-300 mt-1">
                                      WO: {item.extracted_work_order_number}
                                    </div>
                                  )}
                                  {item.extraction_rationale && (
                                    <div className="text-gray-500 mt-1 italic">
                                      {item.extraction_rationale}
                                    </div>
                                  )}
                                  {/* Snippet Preview */}
                                  {(item.snippet_url || item.preview_image_url) && (
                                    <div className="mt-3 pt-2 border-t border-gray-700">
                                      <div className="text-xs font-semibold text-gray-400 mb-2">Snippet Preview:</div>
                                      <img
                                        src={item.snippet_url || item.preview_image_url || ""}
                                        alt="Extraction snippet"
                                        className="max-w-xs h-auto border border-gray-600 rounded object-contain bg-white"
                                        style={{ maxHeight: "120px" }}
                                        onError={(e) => {
                                          e.currentTarget.style.display = "none";
                                          const parent = e.currentTarget.parentElement;
                                          if (parent) {
                                            parent.innerHTML = '<span class="text-gray-500 text-xs">Snippet unavailable</span>';
                                          }
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-300 mb-2">Work Order #</div>
                            <div className="text-lg font-mono text-white">
                              {item.manual_work_order_number || "—"}
                            </div>
                            {item.created_at && (
                              <div className="text-xs text-gray-500 mt-2">
                                {new Date(item.created_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            {ux.href && (
                              <Link
                                href={ux.href}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors text-center"
                              >
                                {ux.actionLabel || "Fix"}
                              </Link>
                            )}
                            <button
                              onClick={() => handleResolveClick(item)}
                              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
                            >
                              Resolve
                            </button>
                            {item.signed_pdf_url && (
                              <a
                                href={item.signed_pdf_url}
                                target="_blank"
                                rel="noreferrer"
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors text-center"
                              >
                                View PDF
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Resolve Modal */}
          {showModal && selectedItem && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
                <h2 className="text-xl font-bold text-white mb-4">Confirm Work Order</h2>

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

                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => {
                        setShowModal(false);
                        setWoNumber("");
                        setReasonNote("");
                        setSelectedItem(null);
                        setResolveError(null);
                      }}
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
                      {resolvingId ? "Confirming..." : "Confirm"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
