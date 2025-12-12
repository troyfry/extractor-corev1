"use client";

import React from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import UpgradePrompt from "@/components/plan/UpgradePrompt";
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";
import { canUseProFeatures } from "@/lib/planVisibility";

export default function InvoicesPage() {
  const { plan } = useCurrentPlan();
  const canUseInvoices = hasFeature(plan, "canUseInvoices");
  const canUsePremium = plan === "PREMIUM";

  // Invoices is Premium-only feature
  if (!canUseInvoices && !canUsePremium) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <UpgradePrompt
            requiredPlan="PREMIUM"
            featureName="Invoices"
            description="Invoice management and tracking is available on the Premium plan. Upgrade to access invoice history, aging reports, and payment tracking."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h1 className="text-2xl font-semibold text-white">Invoices</h1>
            {/* Invoices is available on both Pro and Premium, so no Premium badge needed */}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-8">
            <div className="text-center py-12">
              <svg
                className="w-16 h-16 text-gray-600 mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <h2 className="text-xl font-semibold text-white mb-3">Invoice Dashboard</h2>
              <p className="text-gray-400 max-w-md mx-auto mb-6">
                This section will provide a comprehensive invoice dashboard with invoice history, 
                aging reports, payment tracking, and automated invoice generation from work orders.
              </p>
              <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 max-w-lg mx-auto">
                <p className="text-sm text-blue-200">
                  <strong>Coming Soon:</strong> Invoice management, payment tracking, aging reports, 
                  and automated invoice generation from completed work orders.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

