"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingOpenAIPage() {
  const router = useRouter();
  const [openaiKey, setOpenaiKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/onboarding/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiKey }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save OpenAI key");
      }

      router.push("/onboarding/fm-profiles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">OpenAI API Key</h1>
        <p className="text-slate-300 mb-8">
          Enter your OpenAI API key to enable AI-powered work order extraction.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="openaiKey" className="block text-sm font-medium mb-2">
              OpenAI API Key
            </label>
            <input
              id="openaiKey"
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
              required
            />
            <p className="mt-2 text-sm text-slate-400">
              Your API key is encrypted before storage. Get your key from{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 hover:text-sky-300 underline"
              >
                platform.openai.com/api-keys
              </a>
            </p>
          </div>

          {error && (
            <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-200">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {isSubmitting ? "Saving..." : "Save & Continue →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

