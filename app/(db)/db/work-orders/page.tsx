// app/(db)/db/work-orders/page.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface WorkOrder {
  id: string;
  work_order_number: string | null;
  customer_name: string | null;
  service_address: string | null;
  scheduled_date: string | null;
  status: string;
  amount: string | null;
  currency: string | null;
  fm_profile_display_name: string | null;
  signed_at: string | null;
  signed_pdf_url: string | null;
  export_status: "EXPORTED" | "PENDING" | "FAILED" | "FAILED_QUOTA" | null;
  export_error_code: string | null;
  created_at: string;
}

interface WorkOrdersResponse {
  items: WorkOrder[];
  nextCursor: string | null;
  hasMore: boolean;
}

function ParityTool() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    dbCount: number;
    legacyCount: number;
    inBoth: number;
    onlyInDb: Array<{ workOrderNumber: string; fmKey: string | null }>;
    onlyInLegacy: Array<{ workOrderNumber: string; fmKey: string | null }>;
    differences: number;
    fieldDrifts?: {
      counts: {
        status: number;
        signed_at_presence: number;
        amount: number;
        scheduled_date: number;
      };
      totalMismatches: number;
      sample: Array<{
        workOrderNumber: string;
        fmKey: string | null;
        field: string;
        dbValue: string | null;
        legacyValue: string | null;
      }>;
    };
  } | null>(null);

  const handleCompare = async () => {
    try {
      setLoading(true);
      setResult(null);
      const response = await fetch("/api/db/reconcile/sample");
      if (!response.ok) {
        throw new Error("Failed to compare");
      }
      const data = await response.json();
      setResult(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to compare");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleCompare}
        disabled={loading}
        className="px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
      >
        {loading ? "Comparing..." : "Compare latest 50 (DB vs Legacy)"}
      </button>
      {result && (
        <div className="mt-3 p-3 bg-gray-50 border rounded text-sm">
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <span className="font-medium">DB:</span> {result.dbCount}
            </div>
            <div>
              <span className="font-medium">Legacy:</span> {result.legacyCount}
            </div>
            <div>
              <span className="font-medium">In Both:</span> {result.inBoth}
            </div>
            <div>
              <span className="font-medium">Differences:</span> {result.differences}
            </div>
          </div>
          {result.onlyInDb.length > 0 && (
            <div className="mb-2">
              <span className="font-medium text-green-700">Only in DB ({result.onlyInDb.length}):</span>
              <div className="text-xs text-gray-600 mt-1">
                {result.onlyInDb.slice(0, 5).map((wo, idx) => (
                  <div key={idx}>
                    {wo.workOrderNumber} ({wo.fmKey || "no FM"})
                  </div>
                ))}
                {result.onlyInDb.length > 5 && <div>...and {result.onlyInDb.length - 5} more</div>}
              </div>
            </div>
          )}
          {result.onlyInLegacy.length > 0 && (
            <div>
              <span className="font-medium text-orange-700">Only in Legacy ({result.onlyInLegacy.length}):</span>
              <div className="text-xs text-gray-600 mt-1">
                {result.onlyInLegacy.slice(0, 5).map((wo, idx) => (
                  <div key={idx}>
                    {wo.workOrderNumber} ({wo.fmKey || "no FM"})
                  </div>
                ))}
                {result.onlyInLegacy.length > 5 && <div>...and {result.onlyInLegacy.length - 5} more</div>}
              </div>
            </div>
          )}
          {result.fieldDrifts && (
            <div className="mt-3 pt-3 border-t">
              <span className="font-medium text-purple-700">Field Drifts ({result.fieldDrifts.totalMismatches}):</span>
              <div className="text-xs text-gray-600 mt-1 grid grid-cols-2 gap-2">
                <div>Status: {result.fieldDrifts.counts.status}</div>
                <div>Signed At: {result.fieldDrifts.counts.signed_at_presence}</div>
                <div>Amount: {result.fieldDrifts.counts.amount}</div>
                <div>Scheduled Date: {result.fieldDrifts.counts.scheduled_date}</div>
              </div>
              {result.fieldDrifts.sample.length > 0 && (
                <div className="text-xs text-gray-600 mt-2">
                  <div className="font-medium mb-1">Sample mismatches:</div>
                  {result.fieldDrifts.sample.slice(0, 3).map((drift, idx) => (
                    <div key={idx} className="mb-1">
                      {drift.workOrderNumber} ({drift.field}): DB="{drift.dbValue}" Legacy="{drift.legacyValue}"
                    </div>
                  ))}
                  {result.fieldDrifts.sample.length > 3 && <div>...and {result.fieldDrifts.sample.length - 3} more</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DbWorkOrdersPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [primaryReadSource, setPrimaryReadSource] = useState<"LEGACY" | "DB">("LEGACY");
  const [updatingSource, setUpdatingSource] = useState(false);

  const fetchWorkOrders = async (cursor?: string | null) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      if (searchQuery) params.append("q", searchQuery);
      if (cursor) params.append("cursor", cursor);
      params.append("limit", "20");

      const response = await fetch(`/api/db/work-orders?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch work orders");
      }

      const data: WorkOrdersResponse = await response.json();
      
      if (cursor) {
        setWorkOrders((prev) => [...prev, ...data.items]);
      } else {
        setWorkOrders(data.items);
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
    fetchWorkOrders();
    fetchPrimaryReadSource();
  }, [statusFilter, searchQuery]);

  const fetchPrimaryReadSource = async () => {
    try {
      const response = await fetch("/api/db/workspace/read-source");
      if (response.ok) {
        const data = await response.json();
        setPrimaryReadSource(data.primaryReadSource || "LEGACY");
      }
    } catch (err) {
      console.error("Failed to fetch primary read source:", err);
    }
  };

  const handleToggleReadSource = async () => {
    try {
      setUpdatingSource(true);
      const newSource = primaryReadSource === "LEGACY" ? "DB" : "LEGACY";
      const response = await fetch("/api/db/workspace/read-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryReadSource: newSource }),
      });
      if (response.ok) {
        setPrimaryReadSource(newSource);
      } else {
        alert("Failed to update read source");
      }
    } catch (err) {
      alert("Failed to update read source");
    } finally {
      setUpdatingSource(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchWorkOrders();
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: "bg-blue-100 text-blue-800",
      SIGNED: "bg-green-100 text-green-800",
      CLOSED: "bg-gray-100 text-gray-800",
      NEEDS_REVIEW: "bg-yellow-100 text-yellow-800",
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

  const getExportBadge = (exportStatus: string | null, errorCode: string | null) => {
    if (!exportStatus) return null;
    
    const colors: Record<string, string> = {
      EXPORTED: "bg-green-100 text-green-800",
      PENDING: "bg-yellow-100 text-yellow-800",
      FAILED: "bg-red-100 text-red-800",
      FAILED_QUOTA: "bg-orange-100 text-orange-800",
    };
    
    const label = exportStatus === "FAILED_QUOTA" ? "Failed (Quota)" : exportStatus;
    
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-medium ${
          colors[exportStatus] || "bg-gray-100 text-gray-800"
        }`}
        title={errorCode || undefined}
      >
        {label}
      </span>
    );
  };

  const formatCurrency = (amount: string | null, currency: string | null) => {
    if (!amount) return "-";
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    const curr = currency || "USD";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr,
    }).format(num);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Work Orders (DB)</h1>
            <p className="text-gray-600">Database-powered work orders view</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Primary Reads:</span>
              <button
                onClick={handleToggleReadSource}
                disabled={updatingSource}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  primaryReadSource === "DB"
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-800"
                } disabled:opacity-50`}
              >
                {primaryReadSource}
              </button>
            </div>
          </div>
        </div>
        {primaryReadSource === "DB" && (
          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
            {process.env.NEXT_PUBLIC_DB_STRICT_MODE === "true" ? (
              <>🔒 DB Native Mode: No legacy fallback. DB is the only source of truth.</>
            ) : (
              <>ℹ️ DB reads are enabled. Legacy remains as fallback if DB is unavailable.</>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <form onSubmit={handleSearch} className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search by WO#, customer, address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="SIGNED">Signed</option>
              <option value="CLOSED">Closed</option>
              <option value="NEEDS_REVIEW">Needs Review</option>
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Search
          </button>
        </form>
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
                WO#
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Scheduled
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Export
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && workOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : workOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                  No work orders found
                </td>
              </tr>
            ) : (
              workOrders.map((wo) => (
                <tr key={wo.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      href={`/db/work-orders/${wo.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {wo.work_order_number || "-"}
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {wo.customer_name || "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {wo.service_address || "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {wo.scheduled_date || "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(wo.amount, wo.currency)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(wo.status)}
                    {wo.signed_at && (
                      <span className="ml-2 text-xs text-green-600">✓ Signed</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getExportBadge(wo.export_status, wo.export_error_code)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <Link
                      href={`/db/work-orders/${wo.id}`}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      View
                    </Link>
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
            onClick={() => fetchWorkOrders(nextCursor)}
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
