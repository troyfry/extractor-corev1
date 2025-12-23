"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function OnboardingDonePage() {
  const router = useRouter();
  const [isCompleting, setIsCompleting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const completeOnboarding = async () => {
      try {
        const response = await fetch("/api/onboarding/complete", {
          method: "POST",
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to complete onboarding");
        }

        setIsCompleting(false);
        // Redirect immediately
        router.push("/pro");
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
        setIsCompleting(false);
      }
    };

    completeOnboarding();
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-2xl mx-auto">
        {isCompleting ? (
          <div>
            <h1 className="text-3xl font-semibold mb-4">Completing Setup...</h1>
            <p className="text-slate-300">Please wait while we finalize your configuration.</p>
          </div>
        ) : error ? (
          <div>
            <h1 className="text-3xl font-semibold mb-4 text-red-400">Error</h1>
            <p className="text-slate-300 mb-4">{error}</p>
            <Link
              href="/onboarding"
              className="inline-block px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
            >
              Try Again
            </Link>
          </div>
        ) : (
          <div>
            <h1 className="text-3xl font-semibold mb-4">Onboarding Complete!</h1>
            <p className="text-slate-300 mb-8">
              You&apos;re all set up. Redirecting to your dashboard...
            </p>
            <Link
              href="/pro"
              className="inline-block px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
            >
              Go to Dashboard →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

