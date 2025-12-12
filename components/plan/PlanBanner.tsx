"use client";

import React from "react";
import Link from "next/link";
import { useCurrentPlan } from "@/lib/plan-context";
import { getPlanLabel, isPremiumPlan } from "@/lib/plan-helpers";
import { isDevMode } from "@/lib/env";

/**
 * PlanBanner component displays the current plan and upgrade CTA.
 * 
 * Use this component to show plan status and upgrade options throughout the app.
 */
interface PlanBannerProps {
  showUpgrade?: boolean;
  className?: string;
}

export default function PlanBanner({ showUpgrade = true, className = "" }: PlanBannerProps) {
  const { plan } = useCurrentPlan();
  const planLabel = getPlanLabel(plan);

  const planColors: Record<string, string> = {
    FREE_BYOK: "bg-gray-700 text-gray-300",
    PRO: "bg-blue-700 text-blue-200",
    PREMIUM: "bg-purple-700 text-purple-200",
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className={`px-3 py-1 rounded text-xs font-medium ${planColors[plan] || planColors.FREE_BYOK}`}>
        Plan: {planLabel}
      </span>
      {showUpgrade && (!isPremiumPlan(plan) || isDevMode) && (
        <Link
          href="/pricing"
          className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition-colors"
        >
          {isPremiumPlan(plan) && isDevMode ? "Pricing" : "Upgrade"}
        </Link>
      )}
    </div>
  );
}

