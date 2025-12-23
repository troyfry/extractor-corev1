"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import { CopyButton } from "./CopyButton";

type WorkOrderDetail = {
  jobId: string;
  fmKey: string | null;
  wo_number: string;
  status: string;
  scheduled_date: string | null;
  created_at: string;
  timestamp_extracted: string | null;
  signed_at: string | null;
  work_order_pdf_link: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
  customer_name: string | null;
  vendor_name: string | null;
  service_address: string | null;
  job_type: string | null;
  job_description: string | null;
  amount: string | null;
  currency: string | null;
  notes: string | null;
  priority: string | null;
  calendar_event_link: string | null;
  source: string | null;
  last_updated_at: string;
  // Additional fields that might exist
  original_pdf_url?: string | null;
  raw_ocr_text?: string | null;
  rawText?: string | null;
};

type Props = {
  jobId: string;
};

export default function WorkOrderDetailClient({ jobId }: Props) {
  const [workOrder, setWorkOrder] = useState<WorkOrderDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWorkOrder();
  }, [jobId]);

  async function loadWorkOrder() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/pro/work-orders/${jobId}`);
      if (response.ok) {
        const data = await response.json();
        setWorkOrder(data.workOrder);
      } else if (response.status === 404) {
        setError("Work order not found");
      } else {
        const errorData = await response.json().catch(() => ({ error: "Failed to load work order" }));
        setError(errorData.error || `Failed to load work order (${response.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work order");
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="text-center py-8 text-gray-400">Loading work order...</div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !workOrder) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 text-red-200">
              <h1 className="text-xl font-semibold mb-2">Work Order Not Found</h1>
              <p className="mb-4">{error || "The work order you're looking for doesn't exist."}</p>
              <Link
                href="/pro/work-orders"
                className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                Back to Work Orders
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // Get raw OCR text (check multiple possible field names)
  const rawOcrText = workOrder.raw_ocr_text || workOrder.rawText || null;

  // Determine original PDF URL (prefer work_order_pdf_link, fallback to original_pdf_url)
  const originalPdfUrl = workOrder.work_order_pdf_link || workOrder.original_pdf_url || null;

  // Convert Google Drive view link to direct image link for preview
  const getImageUrl = (url: string | null): string | null => {
    if (!url) return null;
    if (url.startsWith("data:image")) return url;
    if (url.includes("drive.google.com")) {
      const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
        url.match(/id=([a-zA-Z0-9_-]+)/) ||
        url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        // Smaller thumbnail for detail page snippet
        return `https://drive.google.com/thumbnail?id=${fileIdMatch[1]}&sz=w400`;
      }
    }
    return url;
  };

  const previewImageUrl = getImageUrl(workOrder.signed_preview_image_url);

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-4xl mx-auto px-4 pb-8">
          {/* Header */}
          <div className="mb-6">
            <Link
              href="/pro/work-orders"
              className="text-sm text-gray-400 hover:text-gray-300 mb-4 inline-block"
            >
              ← Back to Work Orders
            </Link>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold text-white mb-2">
                  Work Order #{workOrder.wo_number}
                </h1>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span>FM: {workOrder.fmKey || "-"}</span>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      workOrder.status?.toLowerCase().includes("signed")
                        ? "bg-green-900/30 text-green-300 border border-green-700"
                        : workOrder.status?.toLowerCase().includes("review")
                        ? "bg-yellow-900/30 text-yellow-300 border border-yellow-700"
                        : "bg-gray-800 text-gray-300 border border-gray-700"
                    }`}
                  >
                    {workOrder.status || "OPEN"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Documents Section */}
          <section className="mb-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Documents</h2>
            <div className="space-y-3">
              {originalPdfUrl && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-400">Original PDF:</span>
                    <a
                      href={originalPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-blue-400 hover:text-blue-300 underline"
                    >
                      Open PDF
                    </a>
                  </div>
                  <CopyButton text={originalPdfUrl} label="Copy Original PDF link" />
                </div>
              )}
              {workOrder.signed_pdf_url && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-400">Signed PDF:</span>
                    <a
                      href={workOrder.signed_pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-blue-400 hover:text-blue-300 underline"
                    >
                      Open Signed PDF
                    </a>
                  </div>
                  <CopyButton text={workOrder.signed_pdf_url} label="Copy Signed PDF link" />
                </div>
              )}
              {previewImageUrl && (
                <div>
                  <span className="text-sm text-gray-400 block mb-2">Snippet Preview:</span>
                  <a
                    href={workOrder.signed_preview_image_url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block"
                  >
                    <img
                      src={previewImageUrl}
                      alt={`WO ${workOrder.wo_number} preview`}
                      className="max-w-md h-auto border border-gray-600 rounded max-h-64 object-contain"
                      onError={(e) => {
                        // Try fallback: use original URL if converted URL failed
                        const originalUrl = workOrder.signed_preview_image_url;
                        if (originalUrl && e.currentTarget.src !== originalUrl) {
                          e.currentTarget.src = originalUrl;
                        } else {
                          // Hide broken image if both fail and show message
                          e.currentTarget.style.display = "none";
                          const parent = e.currentTarget.parentElement;
                          if (parent) {
                            parent.innerHTML = '<span class="text-gray-500 text-sm">Image unavailable</span>';
                          }
                        }
                      }}
                    />
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Dates Section */}
          <section className="mb-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Dates</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Created:</span>
                <span className="text-white">
                  {workOrder.created_at
                    ? new Date(workOrder.created_at).toLocaleString()
                    : "-"}
                </span>
              </div>
              {workOrder.scheduled_date && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Scheduled:</span>
                  <span className="text-white">
                    {new Date(workOrder.scheduled_date).toLocaleDateString()}
                  </span>
                </div>
              )}
              {workOrder.signed_at && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Signed:</span>
                  <span className="text-white">
                    {new Date(workOrder.signed_at).toLocaleString()}
                  </span>
                </div>
              )}
              {workOrder.last_updated_at && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Last Updated:</span>
                  <span className="text-white">
                    {new Date(workOrder.last_updated_at).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Status History Section */}
          <section className="mb-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Status History</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="text-gray-300">
                  Created {workOrder.created_at ? new Date(workOrder.created_at).toLocaleString() : ""}
                </span>
              </div>
              {workOrder.signed_at && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-gray-300">
                    Signed {new Date(workOrder.signed_at).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Additional Details (if available) */}
          {(workOrder.customer_name ||
            workOrder.vendor_name ||
            workOrder.service_address ||
            workOrder.job_type ||
            workOrder.job_description ||
            workOrder.amount) && (
            <section className="mb-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Additional Details</h2>
              <div className="space-y-2 text-sm">
                {workOrder.customer_name && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Customer:</span>
                    <span className="text-white">{workOrder.customer_name}</span>
                  </div>
                )}
                {workOrder.vendor_name && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Vendor:</span>
                    <span className="text-white">{workOrder.vendor_name}</span>
                  </div>
                )}
                {workOrder.service_address && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Service Address:</span>
                    <span className="text-white">{workOrder.service_address}</span>
                  </div>
                )}
                {workOrder.job_type && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Job Type:</span>
                    <span className="text-white">{workOrder.job_type}</span>
                  </div>
                )}
                {workOrder.job_description && (
                  <div>
                    <span className="text-gray-400 block mb-1">Description:</span>
                    <p className="text-white">{workOrder.job_description}</p>
                  </div>
                )}
                {workOrder.amount && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Amount:</span>
                    <span className="text-white">
                      {workOrder.currency && workOrder.currency !== "USD" ? workOrder.currency : "$"}
                      {workOrder.amount}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Raw OCR Text (collapsed) */}
          {rawOcrText && (
            <section className="mb-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
              <details>
                <summary className="text-lg font-semibold text-white cursor-pointer hover:text-gray-300">
                  Raw OCR Text
                </summary>
                <div className="mt-4 p-4 bg-gray-900 rounded border border-gray-700">
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono overflow-x-auto">
                    {rawOcrText}
                  </pre>
                </div>
              </details>
            </section>
          )}

          {/* Utility Buttons */}
          <section className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Utilities</h2>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={workOrder.wo_number} label="Copy Work Order #" />
              {workOrder.signed_pdf_url && (
                <CopyButton text={workOrder.signed_pdf_url} label="Copy Signed PDF link" />
              )}
              {originalPdfUrl && (
                <CopyButton text={originalPdfUrl} label="Copy Original PDF link" />
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

