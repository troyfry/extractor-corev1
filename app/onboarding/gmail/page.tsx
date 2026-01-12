"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import {
  WORK_ORDERS_LABEL_NAME,
  SIGNED_WORK_ORDERS_LABEL_NAME,
  PROCESSED_WORK_ORDERS_LABEL_NAME,
} from "@/lib/google/gmailConfig";
import { validateLabelName } from "@/lib/google/gmailValidation";

export default function OnboardingGmailPage() {
  const router = useRouter();
  const [workOrdersLabelName, setWorkOrdersLabelName] = useState(WORK_ORDERS_LABEL_NAME);
  const [signedLabelName, setSignedLabelName] = useState(SIGNED_WORK_ORDERS_LABEL_NAME);
  const [processedLabelName, setProcessedLabelName] = useState(PROCESSED_WORK_ORDERS_LABEL_NAME);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      // Validate label names
      const workOrdersLabel = workOrdersLabelName.trim() || WORK_ORDERS_LABEL_NAME;
      const signedLabel = signedLabelName.trim() || SIGNED_WORK_ORDERS_LABEL_NAME;
      const processedLabel = processedLabelName.trim() || PROCESSED_WORK_ORDERS_LABEL_NAME;

      const workOrdersError = validateLabelName(workOrdersLabel);
      if (workOrdersError) {
        setError(`Work Orders Label: ${workOrdersError}`);
        setIsSubmitting(false);
        return;
      }

      const signedError = validateLabelName(signedLabel);
      if (signedError) {
        setError(`Signed Label: ${signedError}`);
        setIsSubmitting(false);
        return;
      }

      if (processedLabel) {
        const processedError = validateLabelName(processedLabel);
        if (processedError) {
          setError(`Processed Label: ${processedError}`);
          setIsSubmitting(false);
          return;
        }
      }

      // Store label names in sessionStorage so done page can use them
      sessionStorage.setItem("gmailWorkOrdersLabelName", workOrdersLabel);
      sessionStorage.setItem("gmailSignedLabelName", signedLabel);
      sessionStorage.setItem("gmailProcessedLabelName", processedLabel);

      // Continue to done page which will complete onboarding
      router.push(ROUTES.onboardingDone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    // Use defaults - continue to done page
    router.push(ROUTES.onboardingDone);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-semibold mb-2">Gmail Label Configuration</h1>
        <p className="text-slate-300 mb-8">
          Configure Gmail labels for organizing work order emails. These labels will be created automatically if they don't exist.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="work-orders-label" className="block text-sm font-medium text-slate-300 mb-2">
              Work Orders Label <span className="text-red-400">*</span>
            </label>
            <input
              id="work-orders-label"
              type="text"
              value={workOrdersLabelName}
              onChange={(e) => setWorkOrdersLabelName(e.target.value)}
              placeholder={WORK_ORDERS_LABEL_NAME}
              required
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-1 text-xs text-slate-400">
              Emails with this label will be processed for work order extraction.
              <br />
              <span className="text-yellow-400">Note: INBOX and other system labels cannot be used.</span>
            </p>
          </div>

          <div>
            <label htmlFor="signed-label" className="block text-sm font-medium text-slate-300 mb-2">
              Signed Work Orders Label <span className="text-red-400">*</span>
            </label>
            <input
              id="signed-label"
              type="text"
              value={signedLabelName}
              onChange={(e) => setSignedLabelName(e.target.value)}
              placeholder={SIGNED_WORK_ORDERS_LABEL_NAME}
              required
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-1 text-xs text-slate-400">
              Emails with this label will be processed for signed work order matching.
              <br />
              <span className="text-yellow-400">Note: INBOX and other system labels cannot be used.</span>
            </p>
          </div>

          <div>
            <label htmlFor="processed-label" className="block text-sm font-medium text-slate-300 mb-2">
              Processed Label (Optional)
            </label>
            <input
              id="processed-label"
              type="text"
              value={processedLabelName}
              onChange={(e) => setProcessedLabelName(e.target.value)}
              placeholder={PROCESSED_WORK_ORDERS_LABEL_NAME}
              className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="mt-1 text-xs text-slate-400">
              This label will be applied to emails after successful processing. Leave empty to skip.
              <br />
              <span className="text-yellow-400">Note: INBOX and other system labels cannot be used.</span>
            </p>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {isSubmitting ? "Saving..." : "Continue"}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={isSubmitting}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              Use Defaults
            </button>
          </div>
        </form>

        <div className="mt-8 p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-200 mb-2">How it works:</h3>
          <ul className="text-sm text-slate-400 space-y-1 list-disc list-inside">
            <li>Labels will be created automatically in your Gmail account if they don't exist</li>
            <li>After processing, the source label is removed and the processed label is applied (if configured)</li>
            <li>You can change these labels later in Settings</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

