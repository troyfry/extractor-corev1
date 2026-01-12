"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROUTES } from "@/lib/routes";

export function ResetOnboardingButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onReset() {
    setError(null);

    const ok = confirm(
      "Reset onboarding?\n\nThis restarts setup in the app. It does not delete anything from your Google Drive or Sheets."
    );
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetch("/api/onboarding/reset", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to reset onboarding");
      }
      router.push(ROUTES.onboardingGoogle);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onReset}
        disabled={loading}
        className="text-sm text-slate-300 hover:text-slate-100 underline disabled:opacity-50"
        title="Restarts setup on this device."
      >
        {loading ? "Resetting..." : "Reset setup"}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}

