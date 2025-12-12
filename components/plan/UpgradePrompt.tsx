"use client";

import React from "react";
import { Plan } from "@/lib/plan";
import { getPlanLabel } from "@/lib/plan-helpers";

/**
 * UpgradePrompt component shows a message when a feature requires a higher plan.
 * 
 * Use this component to gate Premium features and show upgrade CTAs.
 */
interface UpgradePromptProps {
  requiredPlan: Plan;
  featureName: string;
  description?: string;
  className?: string;
}

export default function UpgradePrompt({
  requiredPlan,
  featureName,
  description,
  className = "",
}: UpgradePromptProps) {
  const planLabel = getPlanLabel(requiredPlan);
  const isPremium = requiredPlan === "PREMIUM";

  return (
    <div className={`bg-yellow-900/20 border border-yellow-700 rounded-lg p-8 max-w-2xl mx-auto ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <h1 className="text-2xl font-semibold text-yellow-300">{featureName}</h1>
      </div>
      <p className="text-yellow-200 mb-6">
        {description || `This feature is available on the ${planLabel} plan. Upgrade to access ${featureName.toLowerCase()}.`}
      </p>
      <button
        onClick={() => {
          alert("Upgrade functionality coming soon!");
        }}
        className={`px-6 py-3 text-white rounded hover:opacity-90 font-medium transition-colors ${
          isPremium ? "bg-purple-600 hover:bg-purple-700" : "bg-yellow-600 hover:bg-yellow-700"
        }`}
      >
        Upgrade to {planLabel}
      </button>
    </div>
  );
}

