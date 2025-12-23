"use client";

import React from "react";
import Link from "next/link";

export default function OnboardingPage() {
  // Onboarding status is checked server-side in layout.tsx
  // If completed, user will be redirected to /pro before this component renders

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Welcome to Work Order Suite</h1>
        <p className="text-slate-300 mb-8">
          Let&apos;s get you set up. This wizard will guide you through connecting your Google Sheets,
          Drive folder, OpenAI API key, and configuring your FM profiles.
        </p>
        
        <div className="space-y-4">
          <Link
            href="/onboarding/google"
            className="inline-block px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
          >
            Start Setup →
          </Link>
        </div>
      </div>
    </div>
  );
}

