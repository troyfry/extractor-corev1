"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import UpgradePrompt from "@/components/plan/UpgradePrompt";
import { useCurrentPlan } from "@/lib/plan-context";
import { canUseProFeatures } from "@/lib/planVisibility";

type WorkOrderRow = {
  jobId: string;
  fmKey: string | null;
  wo_number: string;
  status: string | null;
  created_at: string | null;
  scheduled_date: string | null;
  timestamp_extracted: string | null;
  signed_at: string | null;
  work_order_pdf_link: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
};

export default function WorkOrdersPage() {
  const { plan } = useCurrentPlan();
  const canUsePro = canUseProFeatures(plan);

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load work orders on mount
  useEffect(() => {
    if (canUsePro) {
      loadWorkOrders();
    }
  }, [canUsePro]);

  async function loadWorkOrders() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pro/work-orders", {
        headers: {
          "x-plan": plan,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setRows(data.rows || []);
        console.log(`[Work Orders] Loaded ${data.rows?.length || 0} work order(s)`);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Failed to load work orders" }));
        const errorMessage = errorData.error || `Failed to load work orders (${response.status})`;
        setError(errorMessage);
        console.error("[Work Orders] Failed to load work orders:", errorMessage);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load work orders";
      setError(errorMessage);
      console.error("[Work Orders] Failed to load work orders:", err);
    } finally {
      setIsLoading(false);
    }
  }

  if (!canUsePro) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <UpgradePrompt
            requiredPlan="PRO"
            featureName="Work Orders"
            description="View and manage all work orders from your Google Sheets. This feature is available on the Pro plan."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">Work Orders</h1>
            <p className="text-sm text-gray-400">
              One row per work order. Data is synced from Google Sheets (Work_Orders tab).
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded p-4 text-red-200 mb-4">
              {error}
            </div>
          )}

          {/* Table */}
          {isLoading && rows.length === 0 ? (
            <div className="text-center py-8 text-gray-400">Loading work orders...</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400">No work orders found yet.</p>
          ) : (
            <div className="overflow-x-auto border border-gray-700 rounded-lg bg-gray-800">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Work Order #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      FM
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Created At
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Scheduled Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Signed PDF
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Snippet
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {rows.map((row) => (
                    <tr key={row.jobId} className="hover:bg-gray-750">
                      <td className="px-4 py-3 whitespace-nowrap text-white font-mono">
                        {row.wo_number}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-300">
                        {row.fmKey || "-"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-300">
                        {row.status || "OPEN"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                        {row.scheduled_date
                          ? new Date(row.scheduled_date).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.signed_pdf_url ? (
                          <a
                            href={row.signed_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline"
                          >
                            Open
                          </a>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.signed_preview_image_url ? (
                          <a
                            href={row.signed_preview_image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <img
                              src={row.signed_preview_image_url}
                              alt={`WO ${row.wo_number} preview`}
                              className="h-10 w-auto border border-gray-600 rounded"
                            />
                          </a>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

