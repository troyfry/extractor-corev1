"use client";

import React from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import UpgradePrompt from "@/components/plan/UpgradePrompt";
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";
import { canUsePremiumFeatures } from "@/lib/planVisibility";

export default function PortalPage() {
  const { plan } = useCurrentPlan();
  const canUsePortal = hasFeature(plan, "canUseCustomerPortal");
  const canUsePremium = canUsePremiumFeatures(plan);

  // Hide Premium features if not available and dev override is off
  if (!canUsePortal && !canUsePremium) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <UpgradePrompt
            requiredPlan="PREMIUM"
            featureName="Customer Portal"
            description="Provide your customers with a secure, read-only portal to view their work orders and invoices. This feature is available on the Premium plan."
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
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            <h1 className="text-2xl font-semibold text-white">Customer Portal</h1>
            <span className="px-2 py-1 bg-purple-700 text-purple-200 rounded text-xs font-medium">
              Premium
            </span>
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
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
              <h2 className="text-xl font-semibold text-white mb-3">Customer Portal</h2>
              <p className="text-gray-400 max-w-md mx-auto mb-6">
                Provide your customers with a secure, read-only portal to view their work orders, 
                invoices, and service history. Customers can access their portal via a unique link 
                without needing to create an account.
              </p>
              <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 max-w-lg mx-auto">
                <p className="text-sm text-blue-200">
                  <strong>Coming Soon:</strong> Read-only customer portal with work order history, 
                  invoice viewing, and customizable branding. Customers access via secure, shareable links.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

