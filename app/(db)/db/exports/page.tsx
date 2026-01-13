// app/(db)/db/exports/page.tsx
"use client";

import { useState, useEffect } from "react";

interface ExportJob {
  id: string;
  job_type: string;
  entity_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  next_retry_at: string | null;
  work_order_id: string | null;
  work_order_number: string | null;
  created_at: string;
  completed_at: string | null;
}

interface ExportJobsResponse {
  items: ExportJob[];
  nextCursor: string | null;
  hasMore: boolean;
}

export default function DbExportsPage() {
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<{
    processed: number;
    succeeded: number;
    failed: number;
    failedQuota: number;
    remainingPending: number;
  } | null>(null);

  const handleProcessPending = async () => {
    try {
      setProcessing(true);
      setProcessResult(null);
      const response = await fetch("/api/db/export-jobs/process?limit=10", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to process export jobs");
      }
      const data = await response.json();
      setProcessResult(data);
      // Refresh list
      await fetchExportJobs();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to process export jobs");
    } finally {
      setProcessing(false);
    }
  };

  const fetchExportJobs = async (cursor?: string | null) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      if (cursor) params.append("cursor", cursor);
      params.append("limit", "20");

      const response = await fetch(`/api/db/export-jobs?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch export jobs");
      }

      const data: ExportJobsResponse = await response.json();

      if (cursor) {
        setExportJobs((prev) => [...prev, ...data.items]);
      } else {
        setExportJobs(data.items);
      }

      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExportJobs();
  }, [statusFilter]);

  const handleRetry = async (exportJobId: string) => {
    try {
      setRetrying(exportJobId);
      const response = await fetch(`/api/db/export-jobs/${exportJobId}/retry`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to retry export job");
      }
      // Refresh list
      await fetchExportJobs();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to retry export job");
    } finally {
      setRetrying(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DONE: "bg-green-100 text-green-800",
      PENDING: "bg-yellow-100 text-yellow-800",
      PROCESSING: "bg-blue-100 text-blue-800",
      FAILED: "bg-red-100 text-red-800",
    };
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-medium ${
          colors[status] || "bg-gray-100 text-gray-800"
        }`}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Export Queue (DB)</h1>
        <p className="text-gray-600">Database-powered export jobs queue</p>
      </div>

      {/* Filters and Process Button */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex gap-4 items-center">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="PROCESSING">Processing</option>
            <option value="DONE">Done</option>
            <option value="FAILED">Failed</option>
          </select>
          <button
            onClick={handleProcessPending}
            disabled={processing}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {processing ? "Processing..." : "Process Pending Now"}
          </button>
        </div>
        {processResult && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
            <p className="text-sm font-medium text-blue-900">Processing Results:</p>
            <ul className="text-sm text-blue-700 mt-1">
              <li>Processed: {processResult.processed}</li>
              <li>Succeeded: {processResult.succeeded}</li>
              <li>Failed: {processResult.failed}</li>
              {processResult.failedQuota > 0 && (
                <li className="text-orange-600">Failed (Quota): {processResult.failedQuota}</li>
              )}
              <li>Remaining Pending: {processResult.remainingPending}</li>
            </ul>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Job Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Work Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Attempts
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Error
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Next Retry
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && exportJobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : exportJobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                  No export jobs found
                </td>
              </tr>
            ) : (
              exportJobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {job.job_type}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {job.work_order_number ? (
                      <a
                        href={`/db/work-orders/${job.work_order_id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {job.work_order_number}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(job.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {job.attempts}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {job.error_code ? (
                      <span className="text-red-600" title={job.error_message || undefined}>
                        {job.error_code}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {job.next_retry_at
                      ? new Date(job.next_retry_at).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {job.status === "FAILED" && (
                      <button
                        onClick={() => handleRetry(job.id)}
                        disabled={retrying === job.id}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        {retrying === job.id ? "Retrying..." : "Retry"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={() => fetchExportJobs(nextCursor)}
            disabled={loading}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
