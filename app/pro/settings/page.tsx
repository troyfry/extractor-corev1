"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import BYOKKeyInput from "@/components/plan/BYOKKeyInput";

export default function ProSettingsPage() {
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  const handleResetWorkspace = async () => {
    if (resetConfirmText !== "RESET") {
      setResetError("Please type RESET to confirm");
      return;
    }

    setIsResetting(true);
    setResetError(null);

    try {
      const response = await fetch("/api/workspace/reset", {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reset workspace");
      }

      // Redirect to onboarding with message
      router.push("/onboarding?reset=true");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "An error occurred");
      setIsResetting(false);
      setShowResetConfirm(false);
      setResetConfirmText("");
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
              {/* OpenAI API Key Configuration */}
              <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
                <h2 className="text-xl font-semibold text-slate-50 mb-4">
                  AI Parsing (Optional)
                </h2>
                <p className="text-sm text-slate-400 mb-4">
                  Configure your OpenAI API key to enable AI-powered work order extraction. This is optional - you can use rule-based parsing without AI.
                </p>
                <BYOKKeyInput />
              </section>

              {/* Facility Senders */}
              <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
                <h2 className="text-xl font-semibold text-slate-50 mb-4">
                  Facility Senders
                </h2>
                <p className="text-sm text-slate-400">
                  Manage facility management platforms that send work orders. (Coming soon)
                </p>
              </section>

              {/* Capture Zones */}
              <section className="rounded-xl border border-slate-700 bg-slate-800 p-6">
                <h2 className="text-xl font-semibold text-slate-50 mb-4">
                  Capture Zones
                </h2>
                <p className="text-sm text-slate-400">
                  Configure capture zones for different work order formats. (Coming soon)
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

              {/* Danger Zone: Reset Workspace */}
              <section className="rounded-xl border border-red-700 bg-red-900/20 p-6">
                <h2 className="text-xl font-semibold text-red-200 mb-2">
                  Danger Zone
                </h2>
                <h3 className="text-lg font-semibold text-red-200/90 mb-2">
                  Reset Workspace
                </h3>
                <p className="text-sm text-red-200/80 mb-4">
                  This will remove all FM profiles, capture zones, and tracking configuration.
                  <br />
                  <strong>Uploaded files are NOT deleted.</strong>
                </p>
                
                {!showResetConfirm ? (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium transition-colors"
                  >
                    Reset Workspace (Deletes all setup and templates)
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-red-200/90 mb-2">
                        Type <strong>RESET</strong> to confirm:
                      </label>
                      <input
                        type="text"
                        value={resetConfirmText}
                        onChange={(e) => setResetConfirmText(e.target.value)}
                        placeholder="RESET"
                        className="w-full px-4 py-2 bg-red-900/30 border border-red-700 rounded text-white placeholder-red-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                        disabled={isResetting}
                      />
                    </div>
                    {resetError && (
                      <div className="p-3 bg-red-900/30 border border-red-700 rounded text-red-200 text-sm">
                        {resetError}
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        onClick={handleResetWorkspace}
                        disabled={isResetting || resetConfirmText !== "RESET"}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
                      >
                        {isResetting ? "Resetting..." : "Confirm Reset"}
                      </button>
                      <button
                        onClick={() => {
                          setShowResetConfirm(false);
                          setResetConfirmText("");
                          setResetError(null);
                        }}
                        disabled={isResetting}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

