"use client";

import React from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";

export default function ImportWorkOrdersPage() {
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
                Import New Work Orders
              </h1>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
              <p className="text-lg text-slate-300 mb-4">
                Import Work Orders (Coming Next)
              </p>
              <p className="text-sm text-slate-400">
                This section is not wired yet. Safe to click. Will be implemented in Phase 3.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

