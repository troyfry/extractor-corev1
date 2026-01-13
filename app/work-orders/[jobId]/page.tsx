"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import MainNavigation from "@/components/layout/MainNavigation";
import { ROUTES } from "@/lib/routes";
import type { WorkOrder } from "@/lib/workOrders/types";

// Copy button component
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

export default function WorkOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params?.jobId as string;
  const [workOrder, setWorkOrder] = useState<WorkOrder & { signedAt?: string | null; lastUpdatedAt?: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (jobId) {
      loadWorkOrder();
    }
  }, [jobId]);

  async function loadWorkOrder() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/work-orders/${jobId}`);
      if (response.ok) {
        const data = await response.json();
        setWorkOrder(data.workOrder);
        setDataSource(data.dataSource || "LEGACY");
        setFallbackUsed(data.fallbackUsed || false);
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

  // Convert Google Drive view link to direct image link for preview
  const getImageUrl = (url: string | null): string | null => {
    if (!url) return null;
    if (url.startsWith("data:image")) return url;
    if (url.includes("drive.google.com")) {
      const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
        url.match(/id=([a-zA-Z0-9_-]+)/) ||
        url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        return `https://drive.google.com/thumbnail?id=${fileIdMatch[1]}&sz=w400`;
      }
    }
    return url;
  };

  const previewImageUrl = workOrder ? getImageUrl(workOrder.signedPreviewImageUrl) : null;
  const originalPdfUrl = workOrder?.workOrderPdfLink || null;

  if (isLoading) {
    return (
      <>
        <MainNavigation currentMode="work-orders" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="text-center py-8 text-gray-400">Loading work order...</div>
          </div>
        </div>
      </>
    );
  }

  if (error || !workOrder) {
    return (
      <>
        <MainNavigation currentMode="work-orders" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 text-red-200">
              <h1 className="text-xl font-semibold mb-2">Work Order Not Found</h1>
              <p className="mb-4">{error || "The work order you're looking for doesn't exist."}</p>
              <Link
                href={ROUTES.workOrders}
                className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                Back to Work Orders
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <MainNavigation currentMode="work-orders" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-4xl mx-auto px-4 pb-8">
          {/* Header */}
          <div className="mb-6">
            <Link
              href={ROUTES.workOrders}
              className="text-sm text-gray-400 hover:text-gray-300 mb-4 inline-block"
            >
              ← Back to Work Orders
            </Link>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-semibold text-white mb-2">
                  Work Order #{workOrder.workOrderNumber}
                </h1>
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span>FM: {workOrder.fmKey || "-"}</span>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      workOrder.status?.toUpperCase() === "SIGNED"
                        ? "bg-green-900/30 text-green-300 border border-green-700"
                        : workOrder.status?.toUpperCase() === "OPEN"
                        ? "bg-blue-900/30 text-blue-300 border border-blue-700"
                        : "bg-gray-800 text-gray-300 border border-gray-700"
                    }`}
                  >
                    {workOrder.status || "OPEN"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    dataSource === "DB"
                      ? "bg-green-900/30 text-green-300 border border-green-700"
                      : "bg-gray-800 text-gray-300 border border-gray-700"
                  }`}
                >
                  Data Source: {dataSource}
                </span>
                {fallbackUsed && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-orange-900/30 text-orange-300 border border-orange-700">
                    DB unavailable — showing Legacy
                  </span>
                )}
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
              {workOrder.signedPdfUrl && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-400">Signed PDF:</span>
                    <a
                      href={workOrder.signedPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-blue-400 hover:text-blue-300 underline"
                    >
                      Open Signed PDF
                    </a>
                  </div>
                  <CopyButton text={workOrder.signedPdfUrl} label="Copy Signed PDF link" />
                </div>
              )}
              {previewImageUrl && (
                <div>
                  <span className="text-sm text-gray-400 block mb-2">Snippet Preview:</span>
                  <a
                    href={workOrder.signedPreviewImageUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block"
                  >
                    <img
                      src={previewImageUrl}
                      alt={`WO ${workOrder.workOrderNumber} preview`}
                      className="max-w-sm h-auto border border-gray-600 rounded max-h-32 object-contain bg-white"
                      onError={(e) => {
                        const originalUrl = workOrder.signedPreviewImageUrl;
                        if (originalUrl && e.currentTarget.src !== originalUrl) {
                          e.currentTarget.src = originalUrl;
                        } else {
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
                  {workOrder.createdAt
                    ? new Date(workOrder.createdAt).toLocaleString()
                    : "-"}
                </span>
              </div>
              {workOrder.scheduledDate && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Scheduled:</span>
                  <span className="text-white">
                    {new Date(workOrder.scheduledDate).toLocaleDateString()}
                  </span>
                </div>
              )}
              {workOrder.signedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Signed:</span>
                  <span className="text-white">
                    {new Date(workOrder.signedAt).toLocaleString()}
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
                  Created {workOrder.createdAt ? new Date(workOrder.createdAt).toLocaleString() : ""}
                </span>
              </div>
              {workOrder.signedAt && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-gray-300">
                    Signed {new Date(workOrder.signedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Additional Details Section */}
          {(workOrder.customerName ||
            workOrder.vendorName ||
            workOrder.serviceAddress ||
            workOrder.jobType ||
            workOrder.jobDescription ||
            workOrder.amount) && (
            <section className="mb-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Additional Details</h2>
              <div className="space-y-2 text-sm">
                {workOrder.customerName && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Customer:</span>
                    <span className="text-white">{workOrder.customerName}</span>
                  </div>
                )}
                {workOrder.vendorName && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Vendor:</span>
                    <span className="text-white">{workOrder.vendorName}</span>
                  </div>
                )}
                {workOrder.serviceAddress && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Service Address:</span>
                    <span className="text-white">{workOrder.serviceAddress}</span>
                  </div>
                )}
                {workOrder.jobType && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Job Type:</span>
                    <span className="text-white">{workOrder.jobType}</span>
                  </div>
                )}
                {workOrder.jobDescription && (
                  <div>
                    <span className="text-gray-400 block mb-1">Description:</span>
                    <p className="text-white">{workOrder.jobDescription}</p>
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

          {/* Utilities Section */}
          <section className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Utilities</h2>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={workOrder.workOrderNumber} label="Copy Work Order #" />
              {workOrder.signedPdfUrl && (
                <CopyButton text={workOrder.signedPdfUrl} label="Copy Signed PDF link" />
              )}
              {originalPdfUrl && (
                <CopyButton text={originalPdfUrl} label="Copy Original PDF link" />
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
