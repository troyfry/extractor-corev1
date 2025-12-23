"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";

export default function ProSettingsPage() {
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
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

