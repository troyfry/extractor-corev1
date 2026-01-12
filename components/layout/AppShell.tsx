"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import UserMenu from "@/components/auth/UserMenu";
import PlanSelector from "@/components/plan/PlanSelector";
import PlanBanner from "@/components/plan/PlanBanner";
import { useCurrentPlan } from "@/lib/plan-context";
import { isFreePlan } from "@/lib/plan-helpers";
import { isDevMode } from "@/lib/env";

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { plan } = useCurrentPlan();
  const isFree = isFreePlan(plan);
  const pathname = usePathname();
  const isFreePage = pathname === ROUTES.free || pathname?.startsWith(`${ROUTES.free}/`);

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Top bar */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold text-white">
              Work Order Extractor
            </h1>
            <div className="flex items-center gap-4">
              {/* Show plan banner in dev mode OR when not Free */}
              {(isDevMode || !isFree) && <PlanBanner />}
              {!isFree && (
                <span className="text-sm text-gray-400 hidden sm:block">
                  Alpha version – local data only
                </span>
              )}
              {/* Show Upgrade to Pro link on /free page OR in dev mode */}
              {(isFreePage || isDevMode) && (
                <Link
                  href={ROUTES.pricing}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors"
                >
                  {isFreePage ? "Upgrade to Pro" : "Pricing"}
                </Link>
              )}
              {/* Only show UserMenu if not on free page (free page doesn't require auth) */}
              {!isFreePage && <UserMenu />}
            </div>
          </div>
        </div>
      </div>

      {/* Content container */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hide plan selector on /free page - free page should always behave as free */}
        {isDevMode && !isFreePage && <PlanSelector />}
        {children}
      </div>
    </div>
  );
}

