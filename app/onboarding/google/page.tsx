"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingGooglePage() {
  const router = useRouter();
  const [sheetId, setSheetId] = useState("");
  const [driveFolderId, setDriveFolderId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Prevent double-submit
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/onboarding/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId, driveFolderId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save Google settings");
      }

      router.push("/onboarding/openai");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Connect Google</h1>
        <p className="text-slate-300 mb-8">
          Connect your Google Sheets spreadsheet and Drive folder for storing work orders and PDFs.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="sheetId" className="block text-sm font-medium mb-2">
              Google Sheets Spreadsheet ID
            </label>
            <input
              id="sheetId"
              type="text"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="Enter spreadsheet ID or full URL"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
              required
            />
            <p className="mt-2 text-sm text-slate-400">
              You can find this in your Google Sheets URL: <code className="bg-slate-800 px-1 rounded">/spreadsheets/d/SPREADSHEET_ID/edit</code>
            </p>
          </div>

          <div>
            <label htmlFor="driveFolderId" className="block text-sm font-medium mb-2">
              Google Drive Folder ID (Optional)
            </label>
            <input
              id="driveFolderId"
              type="text"
              value={driveFolderId}
              onChange={(e) => setDriveFolderId(e.target.value)}
              placeholder="Enter Drive folder ID"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-2 text-sm text-slate-400">
              Optional: Folder where PDFs and snippets will be stored
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

