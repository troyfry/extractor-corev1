"use client";

import React from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

export default function OnboardingPage() {
  // Onboarding status is checked server-side in layout.tsx
  // If completed, user will be redirected to /pro before this component renders

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Welcome to Work Order Suite</h1>
        <p className="text-slate-300 mb-8">
          Let&apos;s get you set up. This wizard will guide you through:
        </p>
        <ul className="text-slate-300 mb-8 space-y-2 list-disc list-inside">
          <li>Connecting your <strong>Google Drive folder</strong> (required - where work order PDFs are stored)</li>
          <li>Setting up <strong>Gmail labels</strong> for organizing work orders</li>
          <li>Optionally enabling <strong>Google Sheets export</strong> (for backup/export purposes)</li>
          <li>Configuring your <strong>FM profiles</strong> and templates</li>
        </ul>
        
        <div className="space-y-4">
          <Link
            href={ROUTES.onboardingGoogle}
            className="inline-block px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
          >
            Start Setup →
          </Link>
        </div>
      </div>
    </div>
  );
}

