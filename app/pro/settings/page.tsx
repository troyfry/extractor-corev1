"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";

export default function ProSettingsPage() {
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleResetOnboarding = async () => {
    if (!confirm("Are you sure you want to reset onboarding? This will clear all onboarding progress and redirect you to the setup wizard.")) {
      return;
    }

    setIsResetting(true);
    setResetError(null);

    try {
      const response = await fetch("/api/onboarding/reset", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reset onboarding");
      }

      // Redirect to onboarding start
      router.push("/onboarding");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "An error occurred");
      setIsResetting(false);
    }
  };

  return (
    <AppShell>
      <MainNavigation />

      <div className="min-h-screen bg-slate-900">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="space-y-6">
            <div className="flex items-center space-x-4">
              <Link
                href="/pro"
                className="text-slate-400 hover:text-slate-200 transition-colors"
              >
                ← Back
              </Link>
              <h1 className="text-3xl font-bold text-slate-50">
                Settings & Profiles
              </h1>
            </div>

            <div className="space-y-6">
              {/* Facility Management Profiles */}
              <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
                <h2 className="text-xl font-semibold text-slate-50 mb-4">
                  Facility Management Profiles
                </h2>
                <p className="text-sm text-slate-400">
                  Manage your FM profiles for matching work orders. (Coming soon)
                </p>
              </section>

              {/* Templates & OCR Zones */}
              <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
                <h2 className="text-xl font-semibold text-slate-50 mb-4">
                  Templates & OCR Zones
                </h2>
                <p className="text-sm text-slate-400">
                  Configure OCR zones and templates for different work order formats. (Coming soon)
                </p>
              </section>

              {/* Advanced */}
              <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
                <h2 className="text-xl font-semibold text-slate-50 mb-4">
                  Advanced (Column Mapping – coming soon)
                </h2>
                <p className="text-sm text-slate-400">
                  Advanced configuration options will be available here.
                </p>
              </section>

              {/* Reset Onboarding */}
              <section className="rounded-xl border border-red-700 bg-red-900/20 p-6">
                <h2 className="text-xl font-semibold text-red-200 mb-2">
                  Reset Onboarding
                </h2>
                <p className="text-sm text-red-200/80 mb-4">
                  Clear all onboarding progress and start the setup wizard from the beginning. This will clear your spreadsheet and folder selections, but your data in Google Sheets will remain unchanged.
                </p>
                {resetError && (
                  <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-200 text-sm">
                    {resetError}
                  </div>
                )}
                <button
                  onClick={handleResetOnboarding}
                  disabled={isResetting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                >
                  {isResetting ? "Resetting..." : "Reset Onboarding"}
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

