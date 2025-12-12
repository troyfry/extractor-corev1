"use client";

import React from "react";
import { useCurrentPlan } from "@/lib/plan-context";
import { Plan } from "@/lib/plan";
import { getPlanLabel, getPlanShortLabel } from "@/lib/plan-helpers";

/**
 * Development-only plan selector component.
 * 
 * IMPORTANT: This component is DEV ONLY and should be hidden/removed in production.
 * It allows switching between Free, Pro, and Premium plans for testing via localStorage.
 * 
 * In production, plan will be determined from user's actual subscription.
 */
export default function PlanSelector() {
  const { plan, setPlan } = useCurrentPlan();

  // Only show in development
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const allPlans: Plan[] = ["FREE_BYOK", "PRO", "PREMIUM"];

  return (
    <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-yellow-300">DEV: Plan Selector</span>
          <div className="flex gap-2">
            {allPlans.map((p) => (
              <button
                key={p}
                onClick={() => setPlan(p)}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  plan === p
                    ? "bg-yellow-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {getPlanShortLabel(p)}
              </button>
            ))}
          </div>
        </div>
        <span className="text-xs text-yellow-400">
          Current: <strong>{getPlanLabel(plan)}</strong>
        </span>
      </div>
    </div>
  );
}

