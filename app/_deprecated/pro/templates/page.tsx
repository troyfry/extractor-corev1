"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import UpgradePrompt from "@/components/plan/UpgradePrompt";
import { useCurrentPlan } from "@/lib/plan-context";
import { canUseProFeatures } from "@/lib/planVisibility";
import { normalizeFmKey, validateFmProfile, FM_PROFILE_PRESETS } from "@/lib/templates/fmProfiles";
import type { FmProfile } from "@/lib/templates/fmProfiles";

export default function FmProfilesPage() {
  const { plan } = useCurrentPlan();
  const canUsePro = canUseProFeatures(plan);

  const [profiles, setProfiles] = useState<FmProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<FmProfile | null>(null);
  const [formData, setFormData] = useState<Partial<FmProfile>>({
    fmKey: "",
    fmLabel: "",
    page: 1,
    xPct: 0,
    yPct: 0,
    wPct: 0,
    hPct: 0,
    senderDomains: "",
    subjectKeywords: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load profiles on mount
  useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/fm-profiles", {
        headers: {
          "x-plan": plan,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setProfiles(data.profiles || []);
        console.log(`[FM Profiles] Loaded ${data.profiles?.length || 0} profile(s) from Sheets`);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Failed to load profiles" }));
        const errorMessage = errorData.error || `Failed to load profiles (${response.status})`;
        setError(errorMessage);
        console.error("[FM Profiles] Failed to load profiles:", errorMessage);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load profiles";
      setError(errorMessage);
      console.error("[FM Profiles] Failed to load profiles:", err);
    } finally {
      setIsLoading(false);
    }
  }

  function applyPreset(presetName: keyof typeof FM_PROFILE_PRESETS) {
    const preset = FM_PROFILE_PRESETS[presetName];
    setFormData({
      ...formData,
      ...preset,
    });
  }

  function startEdit(profile: FmProfile) {
    setEditingProfile(profile);
    setFormData({
      fmKey: profile.fmKey,
      fmLabel: profile.fmLabel,
      page: profile.page,
      xPct: profile.xPct,
      yPct: profile.yPct,
      wPct: profile.wPct,
      hPct: profile.hPct,
      senderDomains: profile.senderDomains || "",
      subjectKeywords: profile.subjectKeywords || "",
    });
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditingProfile(null);
    setFormData({
      fmKey: "",
      fmLabel: "",
      page: 1,
      xPct: 0,
      yPct: 0,
      wPct: 0,
      hPct: 0,
      senderDomains: "",
      subjectKeywords: "",
    });
    setError(null);
    setSuccess(null);
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);

    // Normalize fmKey
    const normalizedKey = normalizeFmKey(formData.fmKey || "");
    if (!normalizedKey) {
      setError("FM Key is required");
      return;
    }

    // Validate
    const validationError = validateFmProfile({
      ...formData,
      fmKey: normalizedKey,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    try {
      const profile: FmProfile = {
        fmKey: normalizedKey,
        fmLabel: formData.fmLabel!,
        page: formData.page ?? 1,
        xPct: formData.xPct!,
        yPct: formData.yPct!,
        wPct: formData.wPct!,
        hPct: formData.hPct!,
        senderDomains: formData.senderDomains || undefined,
        subjectKeywords: formData.subjectKeywords || undefined,
      };

      const response = await fetch("/api/fm-profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-plan": plan,
        },
        body: JSON.stringify({ profile }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save profile");
      }

      setSuccess("Profile saved successfully!");
      cancelEdit();
      loadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(fmKey: string) {
    if (!confirm(`Delete profile "${fmKey}"?`)) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/fm-profiles?fmKey=${encodeURIComponent(fmKey)}`, {
        method: "DELETE",
        headers: {
          "x-plan": plan,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete profile");
      }

      setSuccess("Profile deleted successfully!");
      loadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete profile");
    } finally {
      setIsLoading(false);
    }
  }

  if (!canUsePro) {
    return (
      <AppShell>
        <MainNavigation />
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <UpgradePrompt
            requiredPlan="PRO"
            featureName="Facility Senders"
            description="Configure facility management platforms that send work orders. This feature is available on the Pro plan."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">Facility Senders</h1>
            <p className="text-gray-400">Configure facility management platforms that send work orders. Profiles are saved to your Google Sheet.</p>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-900/20 border border-red-700 rounded p-4 text-red-200 mb-4">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-900/20 border border-green-700 rounded p-4 text-green-200 mb-4">
              {success}
            </div>
          )}

          {/* Profile Form */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editingProfile ? `Edit Profile: ${editingProfile.fmKey}` : "Create New Profile"}
            </h2>

            <div className="space-y-4">
              {/* Preset Buttons */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Quick Presets
                </label>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => applyPreset("Top Right WO#")}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    Preset A: Top Right WO#
                  </button>
                  <button
                    onClick={() => applyPreset("Left Third Down")}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    Preset B: Left Third Down
                  </button>
                  <button
                    onClick={() => applyPreset("Top Right Panel")}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                  >
                    Preset C: Top Right Panel
                  </button>
                </div>
              </div>

              {/* FM Key */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  FM Key <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.fmKey || ""}
                  onChange={(e) => {
                    // Allow user to type freely, normalize on blur/save
                    setFormData({ ...formData, fmKey: e.target.value });
                  }}
                  onBlur={(e) => {
                    // Normalize when user leaves the field
                    const normalized = normalizeFmKey(e.target.value);
                    setFormData({ ...formData, fmKey: normalized });
                  }}
                  placeholder="e.g., servicechannel, 23rdgroup"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {formData.fmKey && normalizeFmKey(formData.fmKey) !== formData.fmKey && (
                  <p className="mt-1 text-xs text-blue-400">
                    Will be saved as: <code className="bg-gray-900 px-1 rounded">{normalizeFmKey(formData.fmKey)}</code>
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-400">Lowercase slug (normalized on blur: spaces → underscores, special chars removed)</p>
              </div>

              {/* FM Label */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  FM Label <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.fmLabel || ""}
                  onChange={(e) => setFormData({ ...formData, fmLabel: e.target.value })}
                  placeholder="e.g., ServiceChannel"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Page */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Page <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.page || 1}
                  onChange={(e) => setFormData({ ...formData, page: parseInt(e.target.value) || 1 })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Zone Percentages */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    xPct <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.xPct || 0}
                    onChange={(e) => setFormData({ ...formData, xPct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    yPct <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.yPct || 0}
                    onChange={(e) => setFormData({ ...formData, yPct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    wPct <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.wPct || 0}
                    onChange={(e) => setFormData({ ...formData, wPct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    hPct <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={formData.hPct || 0}
                    onChange={(e) => setFormData({ ...formData, hPct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Optional Fields */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Sender Domains (optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.senderDomains || ""}
                  onChange={(e) => setFormData({ ...formData, senderDomains: e.target.value })}
                  placeholder="e.g., workorders@example.com, noreply@example.com"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Subject Keywords (optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.subjectKeywords || ""}
                  onChange={(e) => setFormData({ ...formData, subjectKeywords: e.target.value })}
                  placeholder="e.g., work order, wo#, ticket"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Form Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={isLoading}
                  className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? "Saving..." : editingProfile ? "Update Profile" : "Save Profile"}
                </button>
                {editingProfile && (
                  <button
                    onClick={cancelEdit}
                    disabled={isLoading}
                    className="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Profiles List */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Saved Profiles</h2>
            {isLoading && profiles.length === 0 ? (
              <div className="text-center py-8 text-gray-400">Loading profiles...</div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-8 text-gray-400">No profiles saved yet. Create one above.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="pb-2 text-sm font-medium text-gray-300">FM Key</th>
                      <th className="pb-2 text-sm font-medium text-gray-300">Label</th>
                      <th className="pb-2 text-sm font-medium text-gray-300">Page</th>
                      <th className="pb-2 text-sm font-medium text-gray-300">Zone</th>
                      <th className="pb-2 text-sm font-medium text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((profile) => (
                      <tr key={profile.fmKey} className="border-b border-gray-700">
                        <td className="py-3 text-sm text-white">{profile.fmKey}</td>
                        <td className="py-3 text-sm text-white">{profile.fmLabel}</td>
                        <td className="py-3 text-sm text-white">{profile.page}</td>
                        <td className="py-3 text-sm text-gray-400">
                          ({Math.round(profile.xPct * 100)}%, {Math.round(profile.yPct * 100)}%) {Math.round(profile.wPct * 100)}%×{Math.round(profile.hPct * 100)}%
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEdit(profile)}
                              className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(profile.fmKey)}
                              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
