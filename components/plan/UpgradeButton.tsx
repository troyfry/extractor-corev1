"use client";

import React from "react";
import Link from "next/link";
import { useCurrentPlan } from "@/lib/plan-context";
import { isFreePlan } from "@/lib/plan-helpers";
import { isDevMode } from "@/lib/env";

interface UpgradeButtonProps {
  className?: string;
}

/**
 * Clean, minimal upgrade link for Free users.
 * Also shows in dev mode so developers can access pricing page.
 * For Pro/Premium users in production, this component renders nothing.
 */
export default function UpgradeButton({ className = "" }: UpgradeButtonProps) {
  const { plan } = useCurrentPlan();
  
  // Show for Free users OR in dev mode (so developers can access pricing)
  if (!isFreePlan(plan) && !isDevMode) {
    return null;
  }

  return (
    <Link
      href="/pricing"
      className={`inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-300 transition-colors ${className}`}
    >
      {isFreePlan(plan) ? "Upgrade to Pro →" : "View Pricing →"}
    </Link>
  );
}

