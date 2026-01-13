// app/(db)/db/work-orders/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface WorkOrderDetail {
  id: string;
  work_order_number: string | null;
  customer_name: string | null;
  service_address: string | null;
  job_type: string | null;
  job_description: string | null;
  vendor_name: string | null;
  scheduled_date: string | null;
  priority: string | null;
  amount: string | null;
  currency: string | null;
  nte_amount: string | null;
  status: string;
  work_order_pdf_link: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
  signed_at: string | null;
  notes: string | null;
  fm_key: string | null;
  fm_profile_display_name: string | null;
  sources: Array<{
    id: string;
    source_type: string;
    file_hash: string;
    source_metadata: any;
    created_at: string;
  }>;
  signed_document: {
    id: string;
    extracted_work_order_number: string | null;
    extraction_method: string | null;
    extraction_confidence: string | null;
    extraction_rationale: string | null;
    signed_pdf_url: string | null;
    signed_preview_image_url: string | null;
    created_at: string;
  } | null;
  latest_extraction_run: {
    pipeline_path: string | null;
    wo_number_method: string | null;
    wo_number_confidence: string | null;
    region_used: boolean;
    input_scope: string | null;
    reasons: string[] | null;
    debug: any;
    created_at: string;
  } | null;
  export_jobs: Array<{
    id: string;
    status: string;
    error_code: string | null;
    error_message: string | null;
    attempts: number;
    next_retry_at: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
}

export default function DbWorkOrderDetailPage() {
  const params = useParams();
  const workOrderId = params?.id as string;
  const [workOrder, setWorkOrder] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    if (workOrderId) {
      fetchWorkOrder();
    }
  }, [workOrderId]);

  const fetchWorkOrder = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/db/work-orders/${workOrderId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch work order");
      }
      const data = await response.json();
      setWorkOrder(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleRetryExport = async (exportJobId: string) => {
    try {
      setRetrying(exportJobId);
      const response = await fetch(`/api/db/export-jobs/${exportJobId}/retry`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to retry export");
      }
      // Refresh work order to show updated export status
      await fetchWorkOrder();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to retry export");
    } finally {
      setRetrying(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (error || !workOrder) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error || "Work order not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href="/db/work-orders"
          className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
        >
          ← Back to Work Orders
        </Link>
        <h1 className="text-3xl font-bold mb-2">
          Work Order {workOrder.work_order_number || workOrder.id}
        </h1>
        <div className="flex gap-2 items-center">
          <span
            className={`px-2 py-1 rounded text-xs font-medium ${
              workOrder.status === "SIGNED"
                ? "bg-green-100 text-green-800"
                : workOrder.status === "OPEN"
                ? "bg-blue-100 text-blue-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {workOrder.status}
          </span>
          {workOrder.fm_profile_display_name && (
            <span className="text-sm text-gray-600">
              FM: {workOrder.fm_profile_display_name}
            </span>
          )}
        </div>
      </div>

      {/* Canonical Fields */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Work Order Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500">Customer</label>
            <p className="text-gray-900">{workOrder.customer_name || "-"}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Service Address</label>
            <p className="text-gray-900">{workOrder.service_address || "-"}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Job Type</label>
            <p className="text-gray-900">{workOrder.job_type || "-"}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Scheduled Date</label>
            <p className="text-gray-900">{workOrder.scheduled_date || "-"}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Amount</label>
            <p className="text-gray-900">
              {workOrder.amount
                ? new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: workOrder.currency || "USD",
                  }).format(parseFloat(workOrder.amount))
                : "-"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Priority</label>
            <p className="text-gray-900">{workOrder.priority || "-"}</p>
          </div>
        </div>
        {workOrder.job_description && (
          <div className="mt-4">
            <label className="text-sm font-medium text-gray-500">Description</label>
            <p className="text-gray-900">{workOrder.job_description}</p>
          </div>
        )}
      </div>

      {/* Signed Document Panel */}
      {workOrder.signed_document && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Signed Document</h2>
          <div className="space-y-2">
            <div>
              <label className="text-sm font-medium text-gray-500">Extracted WO#</label>
              <p className="text-gray-900">
                {workOrder.signed_document.extracted_work_order_number || "-"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Extraction Method</label>
              <p className="text-gray-900">
                {workOrder.signed_document.extraction_method || "-"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Confidence</label>
              <p className="text-gray-900">
                {workOrder.signed_document.extraction_confidence
                  ? `${(parseFloat(workOrder.signed_document.extraction_confidence) * 100).toFixed(1)}%`
                  : "-"}
              </p>
            </div>
            {workOrder.signed_document.signed_pdf_url && (
              <div>
                <a
                  href={workOrder.signed_document.signed_pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800"
                >
                  View Signed PDF
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sources Panel */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Sources</h2>
        {workOrder.sources.length === 0 ? (
          <p className="text-gray-500">No sources found</p>
        ) : (
          <div className="space-y-2">
            {workOrder.sources.map((source) => (
              <div key={source.id} className="border-b pb-2">
                <div className="flex justify-between">
                  <span className="font-medium">{source.source_type}</span>
                  <span className="text-sm text-gray-500">
                    {new Date(source.created_at).toLocaleString()}
                  </span>
                </div>
                {source.source_metadata && (
                  <div className="text-sm text-gray-600 mt-1">
                    {JSON.stringify(source.source_metadata, null, 2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Identity Panel (Extraction Provenance) */}
      {workOrder.latest_extraction_run && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Identity (Extraction Provenance)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">WO Number Method</label>
              <p className="text-gray-900">
                {workOrder.latest_extraction_run.wo_number_method || "-"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Confidence</label>
              <p className="text-gray-900">
                {workOrder.latest_extraction_run.wo_number_confidence
                  ? `${(parseFloat(workOrder.latest_extraction_run.wo_number_confidence) * 100).toFixed(1)}%`
                  : "-"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Pipeline Path</label>
              <p className="text-gray-900">
                {workOrder.latest_extraction_run.pipeline_path || "-"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Region Used</label>
              <p className="text-gray-900">
                {workOrder.latest_extraction_run.region_used ? "Yes" : "No"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Input Scope</label>
              <p className="text-gray-900">
                {workOrder.latest_extraction_run.input_scope || "-"}
              </p>
            </div>
            {workOrder.latest_extraction_run.reasons && workOrder.latest_extraction_run.reasons.length > 0 && (
              <div className="col-span-2">
                <label className="text-sm font-medium text-gray-500">Reasons</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {workOrder.latest_extraction_run.reasons.map((reason, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Export History Panel */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Export History</h2>
        {workOrder.export_jobs.length === 0 ? (
          <p className="text-gray-500">No export jobs found</p>
        ) : (
          <div className="space-y-2">
            {workOrder.export_jobs.map((job) => (
              <div
                key={job.id}
                className="border rounded p-3 flex justify-between items-center"
              >
                <div>
                  <div className="flex gap-2 items-center">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        job.status === "DONE"
                          ? "bg-green-100 text-green-800"
                          : job.status === "PENDING"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {job.status}
                    </span>
                    <span className="text-sm text-gray-600">
                      Attempts: {job.attempts}
                    </span>
                    {job.error_code && (
                      <span className="text-sm text-red-600">({job.error_code})</span>
                    )}
                  </div>
                  {job.error_message && (
                    <p className="text-sm text-gray-500 mt-1">{job.error_message}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(job.created_at).toLocaleString()}
                  </p>
                </div>
                {job.status === "FAILED" && (
                  <button
                    onClick={() => handleRetryExport(job.id)}
                    disabled={retrying === job.id}
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {retrying === job.id ? "Retrying..." : "Retry"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
