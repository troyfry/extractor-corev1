"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import UpgradePrompt from "@/components/plan/UpgradePrompt";
import { useCurrentPlan } from "@/lib/plan-context";
import { canUseProFeatures } from "@/lib/planVisibility";

type Tile = {
  href: string;
  title: string;
  description: string;
  icon: string;
};

const TILES: Tile[] = [
  {
    href: "/pro/import",
    title: "Import New Work Orders",
    description: "Upload digital work order PDFs and send them into your job tracking sheet.",
    icon: "📥",
  },
  {
    href: "/pro/signed",
    title: "Process Signed PDFs",
    description: "Match signed work orders from the field to your existing jobs.",
    icon: "✍️",
  },
  {
    href: "/pro/work-orders",
    title: "View Work Orders",
    description: "See your jobs, status, and links to original and signed PDFs.",
    icon: "📋",
  },
  {
    href: "/pro/settings",
    title: "Settings & Profiles",
    description: "Manage FM profiles, templates, and advanced setup.",
    icon: "⚙️",
  },
];

type Props = {
  quotaError?: boolean;
};

export default function ProHomePageClient({ quotaError }: Props = {}) {
  const { plan } = useCurrentPlan();
  const canUsePro = canUseProFeatures(plan);

  return (
    <AppShell>
      <MainNavigation />

      <div className="min-h-screen bg-slate-900">
        <div className="max-w-5xl mx-auto px-4 py-8">
          {/* Quota error message - stable UI, no auto-refresh */}
          {quotaError && (
            <div className="mb-6 rounded-lg border border-yellow-700 bg-yellow-900/20 p-4 text-yellow-200">
              <div className="flex items-start space-x-3">
                <div className="text-xl">⚠️</div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Google Sheets quota hit</h3>
                  <p className="text-sm text-yellow-300">
                    Try again in 60 seconds. The page will not auto-refresh to prevent quota errors.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Gate for non-Pro users */}
          {!canUsePro && (
            <div className="mb-8">
              <UpgradePrompt
                requiredPlan="PRO"
                featureName="Pro Work Order Suite"
                description="Upgrade to unlock digital ingestion, signed OCR, and job tracking for your facility work orders."
              />
            </div>
          )}

          {canUsePro && (
            <div className="space-y-8">
              {/* Header */}
              <header className="text-center space-y-2">
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-50">
                  Work Order Suite
                </h1>
                <p className="text-base text-slate-400">
                  Pick what you want to do.
                </p>
              </header>

              {/* Grid of 4 cards */}
              <div className="grid gap-6 md:grid-cols-2">
                {TILES.map((tile) => (
                  <Link
                    key={tile.href}
                    href={tile.href}
                    className="block rounded-xl border border-slate-700 bg-slate-800 p-6 hover:shadow-md hover:-translate-y-0.5 transition-all"
                  >
                    <div className="flex items-start space-x-4">
                      <div className="text-3xl flex-shrink-0">{tile.icon}</div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-bold text-slate-50 mb-2">
                          {tile.title}
                        </h2>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          {tile.description}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
