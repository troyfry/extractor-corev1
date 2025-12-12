"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import BYOKKeyInput from "@/components/plan/BYOKKeyInput";
import PlanBanner from "@/components/plan/PlanBanner";
import { useCurrentPlan } from "@/lib/plan-context";
import { useUserOpenAIKey } from "@/lib/useUserOpenAIKey";
import { requiresBYOK, usesServerKey, getPlanLabel } from "@/lib/plan-helpers";

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export default function SettingsPage() {
  const { plan } = useCurrentPlan();
  const { key: openaiKey, hasKey } = useUserOpenAIKey();
  const [isHydrated, setIsHydrated] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });

  // Load token usage after hydration to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== "undefined") {
      const loadTokenUsage = () => {
        const stored = localStorage.getItem("tokenUsage");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            setTokenUsage({
              promptTokens: parsed.promptTokens || 0,
              completionTokens: parsed.completionTokens || 0,
              totalTokens: parsed.totalTokens || 0,
            });
          } catch {
            // Invalid JSON, use defaults
            setTokenUsage({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            });
          }
        }
      };

      loadTokenUsage();
      setIsHydrated(true);

      // Listen for storage events to update token usage when other tabs update it
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === "tokenUsage") {
          loadTokenUsage();
        }
      };

      // Listen for custom events (same-tab updates)
      const handleCustomStorage = () => {
        loadTokenUsage();
      };

      window.addEventListener("storage", handleStorageChange);
      window.addEventListener("token-usage-updated", handleCustomStorage);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener("token-usage-updated", handleCustomStorage);
      };
    }
  }, []);

  const handleResetTokens = () => {
    if (
      confirm(
        "Are you sure you want to reset your token usage counter? This action cannot be undone."
      )
    ) {
      const reset: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      setTokenUsage(reset);
      if (typeof window !== "undefined") {
        localStorage.setItem("tokenUsage", JSON.stringify(reset));
        window.dispatchEvent(new Event("token-usage-updated"));
      }
    }
  };

  // Calculate estimated cost (rough estimates based on OpenAI pricing)
  const estimateCost = (tokens: number, isPrompt: boolean) => {
    // Rough estimates: gpt-4o-mini ~$0.15/$0.60 per 1M tokens (input/output)
    // Using average of both for simplicity
    const costPerMillion = isPrompt ? 0.15 : 0.6;
    return (tokens / 1_000_000) * costPerMillion;
  };

  const estimatedPromptCost = estimateCost(tokenUsage.promptTokens, true);
  const estimatedCompletionCost = estimateCost(
    tokenUsage.completionTokens,
    false
  );
  const estimatedTotalCost = estimatedPromptCost + estimatedCompletionCost;

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <h1 className="text-2xl font-semibold text-white">Settings</h1>
          </div>
          <p className="text-gray-400">
            Manage your account settings, API keys, and view usage statistics.
          </p>
        </div>

        <div className="space-y-6">
          {/* Plan Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              Subscription Plan
            </h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">{getPlanLabel(plan)}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {plan === "FREE_BYOK"
                    ? "Free plan with some limits"
                    : plan === "PRO"
                    ? "Professional plan with server-side AI processing"
                    : "Premium plan with all features"}
                </p>
              </div>
              {plan !== "PREMIUM" && (
                <button
                  onClick={() => alert("Upgrade functionality coming soon!")}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium text-sm transition-colors"
                >
                  Upgrade
                </button>
              )}
            </div>
          </div>

          {/* Account Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              Account Information
            </h2>
            <div className="space-y-3 text-gray-300">
              <div>
                <span className="font-medium text-white">Version:</span> v2.0.0
              </div>
              <div>
                <span className="font-medium text-white">Plan:</span>{" "}
                {getPlanLabel(plan)}
              </div>
              <div className="pt-2 border-t border-gray-700">
                <p className="text-sm text-gray-400">
                  This tool helps you extract structured work order data from
                  emails and PDFs. All processing happens in real-time and data
                  is not stored on our servers.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
