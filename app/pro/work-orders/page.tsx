"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import UpgradePrompt from "@/components/plan/UpgradePrompt";
import { useCurrentPlan } from "@/lib/plan-context";
import { canUseProFeatures } from "@/lib/planVisibility";
import { WorkOrdersTableClient } from "./WorkOrdersTableClient";

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

          {/* Table with Filters and Search */}
          {isLoading && rows.length === 0 ? (
            <div className="text-center py-8 text-gray-400">Loading work orders...</div>
          ) : (
            <WorkOrdersTableClient jobs={rows} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

