"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { ROUTES } from "@/lib/routes";

type FmProfile = {
  fmKey: string;
  senderDomains: string;
  subjectKeywords: string;
  hasCoordinates?: boolean; // Whether this profile has template coordinates set
  isExisting?: boolean; // Whether this profile was loaded from DB (vs newly created)
};

export default function OnboardingFmProfilesPage() {
  const router = useRouter();
  const { status } = useSession();
  const [profiles, setProfiles] = useState<FmProfile[]>([
    { fmKey: "", senderDomains: "", subjectKeywords: "", isExisting: false },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Load existing profiles on mount
  useEffect(() => {
    if (status !== "authenticated") return;
    loadExistingProfiles();
  }, [status]);

  const loadExistingProfiles = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/onboarding/fm-profiles");
      if (response.ok) {
        const data = await response.json();
        const existingProfiles = (data.profiles || []).map((p: any) => ({
          fmKey: p.fmKey || "",
          senderDomains: Array.isArray(p.senderDomains) ? p.senderDomains.join(", ") : "",
          subjectKeywords: "", // Not stored in DB yet
          hasCoordinates: p.completeness?.hasWoNumberRegion || false,
          isExisting: true, // Mark as existing profile from DB
        }));
        
        if (existingProfiles.length > 0) {
          setProfiles(existingProfiles);
        }
      }
    } catch (err) {
      console.error("Failed to load existing profiles:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const addProfile = () => {
    setProfiles([...profiles, { fmKey: "", senderDomains: "", subjectKeywords: "", isExisting: false }]);
  };

  const removeProfile = async (index: number) => {
    const profile = profiles[index];
    if (!profile.fmKey.trim()) {
      // Just remove from local state if no fmKey
      if (profiles.length > 1) {
        setProfiles(profiles.filter((_, i) => i !== index));
      }
      return;
    }

    // Delete from server
    try {
      const response = await fetch(`/api/onboarding/fm-profiles?fmKey=${encodeURIComponent(profile.fmKey)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete profile");
      }

      // Remove from local state
      if (profiles.length > 1) {
        setProfiles(profiles.filter((_, i) => i !== index));
      } else {
        // If it's the last one, reset to empty
        setProfiles([{ fmKey: "", senderDomains: "", subjectKeywords: "", isExisting: false }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete profile");
    }
  };

  const handleEdit = async (index: number) => {
    const profile = profiles[index];
    if (!profile.fmKey.trim()) {
      setError("FM Key is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/onboarding/fm-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fmKey: profile.fmKey.trim(),
          senderDomains: profile.senderDomains
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          subjectKeywords: profile.subjectKeywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update profile");
      }

      setEditingIndex(null);
      // Mark as existing after successful save
      const updated = [...profiles];
      updated[index] = { ...updated[index], isExisting: true };
      setProfiles(updated);
      await loadExistingProfiles(); // Reload to get updated data
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateProfile = (index: number, field: keyof FmProfile, value: string) => {
    const updated = [...profiles];
    updated[index] = { ...updated[index], [field]: value };
    setProfiles(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Prevent double-submit
    if (isSubmitting) return;
    
    // Gate on auth status
    if (status !== "authenticated") {
      setError("You need to sign in to continue onboarding.");
      return;
    }
    
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

      // Mark all saved profiles as existing
      const updated = profiles.map((p) => 
        validProfiles.some(vp => vp.fmKey.trim() === p.fmKey.trim()) 
          ? { ...p, isExisting: true }
          : p
      );
      setProfiles(updated);

      setIsSubmitting(false);
      router.push(ROUTES.onboardingTemplates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  // Show loading state while checking auth or loading profiles
  if (status === "loading" || isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-slate-200">Loading…</div>
        </div>
      </div>
    );
  }

  // Show sign-in prompt if not authenticated
  if (status !== "authenticated") {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
        <div className="max-w-4xl mx-auto">
          <p className="mb-4 text-slate-200">You need to sign in to continue onboarding.</p>
          <button
            onClick={() => signIn(undefined, { callbackUrl: ROUTES.onboardingFmProfiles })}
            className="px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium transition-colors"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Facility Senders</h1>
        <p className="text-slate-300 mb-8">
          Set up facility management platforms that send work orders. You can add multiple senders.
        </p>

        <form onSubmit={handleSubmit} className="space-y-8">
          {profiles.map((profile, index) => (
            <div
              key={index}
              className="p-6 bg-slate-800/50 border border-slate-700 rounded-lg space-y-4"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-medium text-slate-200">
                    Profile {index + 1}
                  </h2>
                  {profile.hasCoordinates && (
                    <span className="px-2 py-1 text-xs bg-green-900/30 text-green-300 rounded border border-green-700">
                      ✓ Coordinates Set
                    </span>
                  )}
                  {!profile.hasCoordinates && profile.fmKey.trim() && (
                    <span className="px-2 py-1 text-xs bg-yellow-900/30 text-yellow-300 rounded border border-yellow-700">
                      ⚠ No Coordinates
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {profile.isExisting && editingIndex !== index && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditingIndex(index)}
                        className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
                      >
                        Edit
                      </button>
                    </>
                  )}
                  {profile.isExisting && editingIndex === index && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleEdit(index)}
                        disabled={isSubmitting}
                        className="text-sm text-green-400 hover:text-green-300 transition-colors disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIndex(null);
                          loadExistingProfiles(); // Reload to reset changes
                        }}
                        className="text-sm text-slate-400 hover:text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {(profiles.length > 1 || profile.fmKey.trim()) && (
                    <button
                      type="button"
                      onClick={() => removeProfile(index)}
                      className="text-sm text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
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
                  disabled={profile.isExisting && editingIndex !== index}
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
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
                  disabled={profile.isExisting && editingIndex !== index}
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
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
                  disabled={profile.isExisting && editingIndex !== index}
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
