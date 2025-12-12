"use client";

import React from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import UpgradePrompt from "@/components/plan/UpgradePrompt";
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";
import { canUsePremiumFeatures } from "@/lib/planVisibility";

export default function IntegrationsPage() {
  const { plan } = useCurrentPlan();
  const canUseIntegrations = hasFeature(plan, "canUseIntegrations");
  const canUsePremium = canUsePremiumFeatures(plan);

  // Hide Premium features if not available and dev override is off
  if (!canUseIntegrations && !canUsePremium) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <UpgradePrompt
            requiredPlan="PREMIUM"
            featureName="Integrations"
            description="Connect your work order extractor with third-party tools and automate your workflow. This feature is available on the Premium plan."
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
                d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <h1 className="text-2xl font-semibold text-white">Integrations</h1>
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
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <h2 className="text-xl font-semibold text-white mb-3">Integrations & Automation</h2>
              <p className="text-gray-400 max-w-md mx-auto mb-6">
                Connect your work order extractor with third-party tools and automate your workflow. 
                Sync data with accounting software, project management tools, and more.
              </p>
              <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 max-w-lg mx-auto">
                <p className="text-sm text-blue-200">
                  <strong>Coming Soon:</strong> API access, webhooks, and integrations with popular tools 
                  like QuickBooks, Xero, Slack, Zapier, and custom automation workflows.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

