"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
    title: "Verify & Prepare for Invoice",
    description: "Confirm signatures, resolve issues, and prepare clean invoice-ready data.",
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
    description: "Manage facility senders, capture zones, and advanced setup.",
    icon: "⚙️",
  },
];

type Props = {
  quotaError?: boolean;
};

type SystemStatus = {
  googleConnected: boolean;
  sheetReady: boolean;
  templatesCount: number | null; // null means unknown/not loaded
  verificationCount: number | null; // null means unknown/not loaded
};

export default function ProHomePageClient({ quotaError }: Props = {}) {
  const { plan } = useCurrentPlan();
  const canUsePro = canUseProFeatures(plan);
  const router = useRouter();
  const [status, setStatus] = useState<SystemStatus>({
    googleConnected: false,
    sheetReady: false,
    templatesCount: null,
    verificationCount: null,
  });
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [hasRetried, setHasRetried] = useState(false);

  // Check status via API endpoint (more reliable than cookies)
  useEffect(() => {
    setIsLoadingStatus(true);
    
    // Fetch onboarding status from API
    fetch("/api/onboarding/status")
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        return { onboardingCompleted: false, isAuthenticated: false };
      })
      .then((data) => {
        // Google connected if user is authenticated
        const googleConnected = data.isAuthenticated === true;
        // Sheet ready if onboarding is completed
        const sheetReady = data.onboardingCompleted === true;

        setStatus((prev) => ({
          ...prev,
          googleConnected,
          sheetReady,
        }));

        // Only fetch counts if sheet is ready (to avoid unnecessary API calls)
        if (sheetReady && !quotaError) {
          // Fetch verification count (lightweight, only if sheet ready)
          fetch("/api/signed/needs-review")
            .then((res) => {
              if (res.ok) {
                return res.json();
              }
              return { items: [] };
            })
            .then((data) => {
              setStatus((prev) => ({
                ...prev,
                verificationCount: data.items?.length ?? 0,
              }));
            })
            .catch(() => {
              // Silently fail - show link instead
              setStatus((prev) => ({
                ...prev,
                verificationCount: null,
              }));
            })
            .finally(() => {
              setIsLoadingStatus(false);
            });

          // Templates count - we don't have a lightweight endpoint, so show "Open to confirm"
          setStatus((prev) => ({
            ...prev,
            templatesCount: null,
          }));
        } else {
          setIsLoadingStatus(false);
        }
      })
      .catch(() => {
        // Fallback to cookie check if API fails
        const onboardingCompleted = document.cookie
          .split("; ")
          .find((row) => row.startsWith("onboardingCompleted="))
          ?.split("=")[1];
        
        const workspaceReady = document.cookie
          .split("; ")
          .find((row) => row.startsWith("workspaceReady="))
          ?.split("=")[1];

        const googleConnected = !!onboardingCompleted || !!workspaceReady;
        const sheetReady = onboardingCompleted === "true";

        setStatus((prev) => ({
          ...prev,
          googleConnected,
          sheetReady,
        }));
        setIsLoadingStatus(false);
      });
  }, [quotaError]);

  const handleRetry = () => {
    if (hasRetried) return;
    setHasRetried(true);
    window.location.reload();
  };

  const handleOpenVerification = () => {
    router.push("/pro/signed/needs-review");
  };

  return (
    <AppShell>
      <MainNavigation />

      <div className="min-h-screen bg-slate-900">
        <div className="max-w-5xl mx-auto px-4 py-8">
          {/* Quota error message - improved with buttons */}
          {quotaError && (
            <div className="mb-6 rounded-lg border border-yellow-700 bg-yellow-900/20 p-4 text-yellow-200">
              <div className="flex items-start space-x-3">
                <div className="text-xl">⚠️</div>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Temporary Service Limit</h3>
                  <p className="text-sm text-yellow-300 mb-3">
                    Google Sheets API is temporarily unavailable. Please try again in a moment. The page will not auto-refresh to prevent quota errors.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={handleRetry}
                      disabled={hasRetried}
                      className="px-4 py-2 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium transition-colors text-sm"
                    >
                      {hasRetried ? "Retrying..." : "Retry"}
                    </button>
                    <button
                      onClick={handleOpenVerification}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded font-medium transition-colors text-sm"
                    >
                      Open Verification
                    </button>
                  </div>
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
                Move jobs from completed to paid.
                </p>
              </header>

              {/* System Status Strip */}
              <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status.googleConnected ? "bg-green-500" : "bg-gray-500"}`} />
                    <span className="text-sm text-slate-300">
                      Google: {status.googleConnected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status.sheetReady ? "bg-green-500" : "bg-gray-500"}`} />
                    <span className="text-sm text-slate-300">
                      Sheet: {status.sheetReady ? "Ready" : "Not ready"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-gray-500" />
                    <span className="text-sm text-slate-300">
                      Capture Zones: {status.templatesCount !== null ? `${status.templatesCount} configured` : (
                        <Link href="/pro/template-zones" className="text-blue-400 hover:text-blue-300 underline">
                          Open to confirm
                        </Link>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status.verificationCount !== null && status.verificationCount > 0 ? "bg-yellow-500" : "bg-gray-500"}`} />
                    <span className="text-sm text-slate-300">
                      Verification: {isLoadingStatus ? (
                        <span className="text-slate-500">Loading...</span>
                      ) : status.verificationCount !== null ? (
                        status.verificationCount > 0 ? (
                          <Link href="/pro/signed/needs-review" className="text-yellow-400 hover:text-yellow-300 underline font-medium">
                            {status.verificationCount} pending
                          </Link>
                        ) : (
                          "0 pending"
                        )
                      ) : (
                        <Link href="/pro/signed/needs-review" className="text-blue-400 hover:text-blue-300 underline">
                          Open Verification
                        </Link>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Today's Workflow Section */}
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-50">Today's Workflow</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Link
                    href="/pro/import"
                    className="block rounded-xl border-2 border-blue-600 bg-blue-900/20 p-6 hover:shadow-lg hover:-translate-y-1 transition-all"
                  >
                    <div className="flex items-start space-x-4">
                      <div className="text-3xl flex-shrink-0">📥</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-bold text-slate-50 mb-2">
                          Process New Work Orders
                        </h3>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          Upload digital work order PDFs and send them into your job tracking sheet.
                        </p>
                      </div>
                    </div>
                  </Link>
                  <Link
                    href="/pro/signed/needs-review"
                    className="block rounded-xl border-2 border-yellow-600 bg-yellow-900/20 p-6 hover:shadow-lg hover:-translate-y-1 transition-all"
                  >
                    <div className="flex items-start space-x-4">
                      <div className="text-3xl flex-shrink-0">✓</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-bold text-slate-50 mb-2">
                          Match Signed Paperwork (Verification)
                        </h3>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          Review and verify signed work orders that need attention. This step prepares jobs for invoicing.
                        </p>
                        {status.verificationCount !== null && status.verificationCount > 0 && (
                          <div className="mt-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-900 text-yellow-200">
                              {status.verificationCount} pending
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                </div>
              </div>

              {/* All Tools Section */}
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-50">All Tools</h2>
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
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
