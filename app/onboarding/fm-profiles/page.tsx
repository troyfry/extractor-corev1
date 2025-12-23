"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

type FmProfile = {
  fmKey: string;
  senderDomains: string;
  subjectKeywords: string;
};

export default function OnboardingFmProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<FmProfile[]>([
    { fmKey: "", senderDomains: "", subjectKeywords: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addProfile = () => {
    setProfiles([...profiles, { fmKey: "", senderDomains: "", subjectKeywords: "" }]);
  };

  const removeProfile = (index: number) => {
    if (profiles.length > 1) {
      setProfiles(profiles.filter((_, i) => i !== index));
    }
  };

  const updateProfile = (index: number, field: keyof FmProfile, value: string) => {
    const updated = [...profiles];
    updated[index] = { ...updated[index], [field]: value };
    setProfiles(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // Validate at least one profile has an FM key
    const validProfiles = profiles.filter((p) => p.fmKey.trim());
    if (validProfiles.length === 0) {
      setError("At least one FM profile with an FM Key is required");
      setIsSubmitting(false);
      return;
    }

    try {
      // Send all profiles
      const response = await fetch("/api/onboarding/fm-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: validProfiles.map((p) => ({
            fmKey: p.fmKey.trim(),
            senderDomains: p.senderDomains
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            subjectKeywords: p.subjectKeywords
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save FM profiles");
      }

      router.push("/onboarding/done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">FM Profiles</h1>
        <p className="text-slate-300 mb-8">
          Set up your Facility Management (FM) profiles for matching work orders. You can add multiple profiles.
        </p>

        <form onSubmit={handleSubmit} className="space-y-8">
          {profiles.map((profile, index) => (
            <div
              key={index}
              className="p-6 bg-slate-800/50 border border-slate-700 rounded-lg space-y-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-slate-200">
                  Profile {index + 1}
                </h2>
                {profiles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeProfile(index)}
                    className="text-sm text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div>
                <label
                  htmlFor={`fmKey-${index}`}
                  className="block text-sm font-medium mb-2"
                >
                  FM Key <span className="text-red-400">*</span>
                </label>
                <input
                  id={`fmKey-${index}`}
                  type="text"
                  value={profile.fmKey}
                  onChange={(e) => updateProfile(index, "fmKey", e.target.value)}
                  placeholder="e.g., servicemaster, workorder"
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  required={index === 0}
                />
                <p className="mt-2 text-sm text-slate-400">
                  Unique identifier for this FM platform (lowercase, no spaces)
                </p>
              </div>

              <div>
                <label
                  htmlFor={`senderDomains-${index}`}
                  className="block text-sm font-medium mb-2"
                >
                  Sender Domains (comma-separated)
                </label>
                <input
                  id={`senderDomains-${index}`}
                  type="text"
                  value={profile.senderDomains}
                  onChange={(e) =>
                    updateProfile(index, "senderDomains", e.target.value)
                  }
                  placeholder="e.g., servicemaster.com, workorder.com"
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="mt-2 text-sm text-slate-400">
                  Email domains that send work orders (optional)
                </p>
              </div>

              <div>
                <label
                  htmlFor={`subjectKeywords-${index}`}
                  className="block text-sm font-medium mb-2"
                >
                  Subject Keywords (comma-separated)
                </label>
                <input
                  id={`subjectKeywords-${index}`}
                  type="text"
                  value={profile.subjectKeywords}
                  onChange={(e) =>
                    updateProfile(index, "subjectKeywords", e.target.value)
                  }
                  placeholder="e.g., work order, service request"
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="mt-2 text-sm text-slate-400">
                  Keywords to look for in email subjects (optional)
                </p>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addProfile}
            className="w-full px-4 py-3 border-2 border-dashed border-slate-700 hover:border-sky-600 text-slate-400 hover:text-sky-400 rounded-lg font-medium transition-colors"
          >
            + Add Another Profile
          </button>

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
