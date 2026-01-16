"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { WorkOrder } from "@/lib/workOrders/types";
import MainNavigation from "@/components/layout/MainNavigation";

type FilterType = "all" | "signed" | "unsigned" | "needs-review";

export default function WorkOrdersList() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [dataSource, setDataSource] = useState<"DB" | "LEGACY">("LEGACY");
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const router = useRouter();

  const fetchWorkOrders = React.useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/work-orders");
      
      if (!response.ok) {
        if (response.status === 401) {
          setError("Please sign in to view work orders");
          return;
        }
        
        // Check if workspace is not configured (needs onboarding)
        if (response.status === 404) {
          const data = await response.json().catch(() => ({}));
          if (data.needsOnboarding) {
            // Redirect to onboarding
            router.push("/onboarding");
            return;
          }
        }
        
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch work orders" }));
        throw new Error(errorData.error || "Failed to fetch work orders");
      }

      const data = await response.json();
      
      // Check if this is a DB error response
      if (data.error && data.code === "DB_UNAVAILABLE") {
        setError(`Database unavailable: ${data.error}`);
        setWorkOrders([]);
        setDataSource("DB");
        setFallbackUsed(false);
        return;
      }
      
      setWorkOrders(data.workOrders || []);
      setDataSource(data.dataSource || "LEGACY");
      setFallbackUsed(data.fallbackUsed || false);
    } catch (err) {
      console.error("Error fetching work orders:", err);
      setError(err instanceof Error ? err.message : "Failed to load work orders");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  // Filter and search work orders
  const filteredWorkOrders = useMemo(() => {
    let filtered = workOrders;

    // Apply status filter
    if (filter === "signed") {
      filtered = filtered.filter((wo) => wo.status?.toUpperCase() === "SIGNED");
    } else if (filter === "unsigned") {
      filtered = filtered.filter((wo) => wo.status?.toUpperCase() !== "SIGNED");
    } else if (filter === "needs-review") {
      // For now, filter by status that might indicate needs review
      // This can be enhanced later with a dedicated needs review status
      filtered = filtered.filter((wo) => 
        wo.status?.toUpperCase().includes("REVIEW") || 
        wo.status?.toUpperCase().includes("VERIFICATION")
      );
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((wo) => {
        return (
          wo.workOrderNumber.toLowerCase().includes(query) ||
          (wo.fmKey && wo.fmKey.toLowerCase().includes(query))
        );
      });
    }

    return filtered;
  }, [workOrders, filter, searchQuery]);

  const handleWorkOrderClick = (workOrder: WorkOrder) => {
    // Navigate to work order detail page
    router.push(`/work-orders/${workOrder.jobId || workOrder.id}`);
  };

  if (loading) {
    return (
      <>
        <MainNavigation currentMode="work-orders" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              <p className="mt-4 text-sm text-gray-400">Loading work orders...</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    const isDbError = error.includes("Database unavailable") || error.includes("DB_UNAVAILABLE");
    
    return (
      <>
        <MainNavigation currentMode="work-orders" />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center py-12">
              <div className="mb-4">
                {isDbError ? (
                  <>
                    <div className="text-4xl mb-2">⚠️</div>
                    <p className="text-red-400 text-lg font-semibold mb-2">Database Unavailable</p>
                    <p className="text-gray-400 text-sm">
                      The database is currently unavailable. Please try again in a moment.
                    </p>
                  </>
                ) : (
                  <p className="text-red-400 mb-4">{error}</p>
                )}
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  fetchWorkOrders();
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Retry
              </button>
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
        <div className="max-w-6xl mx-auto px-4 pb-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-white mb-2">Work Orders</h1>
                <p className="text-sm text-gray-400">
                  One row per work order. Data is synced from Google Sheets (Work_Orders tab).
                </p>
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
                {/* Only show fallback warning in rollout mode (not strict mode) */}
                {fallbackUsed && dataSource === "LEGACY" && (
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-orange-900/30 text-orange-300 border border-orange-700">
                    DB unavailable — showing Legacy
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Filters and Search */}
          <div className="mb-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            {/* Filter Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setFilter("all")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  filter === "all"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter("signed")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  filter === "signed"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                Signed
              </button>
              <button
                onClick={() => setFilter("unsigned")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  filter === "unsigned"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                Unsigned
              </button>
              <button
                onClick={() => setFilter("needs-review")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  filter === "needs-review"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                Needs Review
              </button>
            </div>

            {/* Search Bar */}
            <div className="flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search work order or FM key..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Work Order Count */}
          <div className="mb-4 text-sm text-gray-400">
            Showing {filteredWorkOrders.length} of {workOrders.length} work orders
          </div>

          {/* Table */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      WORK ORDER #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      FM
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      STATUS
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      CREATED AT
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      SCHEDULED DATE
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      SIGNED PDF
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {filteredWorkOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                        No work orders found
                      </td>
                    </tr>
                  ) : (
                    filteredWorkOrders.map((wo) => (
                      <tr
                        key={wo.id}
                        className="hover:bg-gray-700/50 cursor-pointer transition-colors"
                        onClick={() => handleWorkOrderClick(wo)}
                      >
                        <td className="px-4 py-3 text-sm">
                          <span className="text-blue-400 hover:text-blue-300 font-medium">
                            {wo.workOrderNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {wo.fmKey || "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              wo.status?.toUpperCase() === "SIGNED"
                                ? "bg-green-900/30 text-green-300"
                                : wo.status?.toUpperCase() === "OPEN"
                                ? "bg-blue-900/30 text-blue-300"
                                : "bg-gray-700 text-gray-300"
                            }`}
                          >
                            {wo.status || "OPEN"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {wo.createdAt
                            ? new Date(wo.createdAt).toLocaleString()
                            : wo.timestampExtracted
                            ? new Date(wo.timestampExtracted).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {wo.scheduledDate
                            ? new Date(wo.scheduledDate).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {wo.signedPdfUrl ? (
                            <a
                              href={wo.signedPdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
