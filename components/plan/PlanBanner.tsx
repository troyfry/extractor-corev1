"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useCurrentPlan } from "@/lib/plan-context";
import { getPlanLabel, isPremiumPlan } from "@/lib/plan-helpers";
import { isDevMode } from "@/lib/env";
import { getDefaultPlan } from "@/lib/plan";

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
  const [isMounted, setIsMounted] = useState(false);

  // Prevent hydration mismatch by only rendering plan-specific content after mount
  // The PlanProvider ensures initial state matches server, but we add extra safety here
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Use the plan from context (which starts with default to match server)
  // After mount, it will update from localStorage if needed
  const planLabel = getPlanLabel(plan);
  const defaultPlan = getDefaultPlan();

  const planColors: Record<string, string> = {
    FREE_BYOK: "bg-gray-700 text-gray-300",
    PRO: "bg-blue-700 text-blue-200",
    PREMIUM: "bg-purple-700 text-purple-200",
  };

  // Use plan from context (will be default on initial render, then update after hydration)
  const displayPlan = plan;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className={`px-3 py-1 rounded text-xs font-medium ${planColors[displayPlan] || planColors.FREE_BYOK}`}>
        Plan: {planLabel}
      </span>
      {isMounted && showUpgrade && (!isPremiumPlan(plan) || isDevMode) && (
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

