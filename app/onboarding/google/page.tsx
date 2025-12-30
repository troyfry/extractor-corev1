"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingGooglePage() {
  const router = useRouter();
  const [folderName, setFolderName] = useState("Work Orders");
  const [sheetName, setSheetName] = useState("Work Order Tracker");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    success?: boolean;
    folderId: string;
    spreadsheetId: string;
    folderUrl: string;
    sheetUrl: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Prevent double-submit
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/onboarding/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          folderName: folderName.trim() || "Work Orders",
          sheetName: sheetName.trim() || "Work Order Tracker",
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to set up workspace");
      }

      const data = await response.json();
      setSuccess(data);
      setIsSubmitting(false);
      
      // Auto-continue after a brief delay to show success
      // Note: Using setTimeout for UX; component unmount will cancel navigation
      setTimeout(() => {
        router.push("/onboarding/openai");
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Set Up Workspace</h1>
        <p className="text-slate-300 mb-8">
          We&apos;ll automatically create a Google Drive folder and Google Sheets spreadsheet for storing your work orders and PDFs.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="folderName" className="block text-sm font-medium mb-2">
              Drive Folder Name
            </label>
            <input
              id="folderName"
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Work Orders"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-2 text-sm text-slate-400">
              We&apos;ll find or create a folder with this name in your Google Drive. PDFs and snippets will be stored here.
            </p>
          </div>

          <div>
            <label htmlFor="sheetName" className="block text-sm font-medium mb-2">
              Spreadsheet Name <span className="text-red-400">*</span>
            </label>
            <input
              id="sheetName"
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="Work Order Tracker"
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
              required
            />
            <p className="mt-2 text-sm text-slate-400">
              We&apos;ll create a new Google Sheets spreadsheet with this name. It will include tabs for Work Orders, Verification, Signatures, and Config.
            </p>
          </div>

          {error && (
            <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-200">
              {error}
            </div>
          )}

          {success && (
            <div className="p-4 bg-green-900/20 border border-green-700 rounded-lg text-green-200">
              <p className="font-medium mb-2">✓ Workspace created successfully!</p>
              <div className="space-y-2 text-sm">
                <div>
                  <a
                    href={success.sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Open Spreadsheet →
                  </a>
                </div>
                <div>
                  <a
                    href={success.folderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Open Folder →
                  </a>
                </div>
              </div>
              <p className="mt-2 text-xs text-green-300">Continuing to next step...</p>
            </div>
          )}

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={isSubmitting || !!success}
              className="px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {isSubmitting ? "Setting up..." : success ? "Continue →" : "Create / Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

