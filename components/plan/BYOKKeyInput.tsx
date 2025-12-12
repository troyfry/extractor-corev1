"use client";

import React, { useState, useEffect } from "react";
import { useUserOpenAIKey } from "@/lib/useUserOpenAIKey";
import { useCurrentPlan } from "@/lib/plan-context";
import { clearUserApiKey } from "@/lib/byok";

/**
 * Component for entering and managing OpenAI API key for FREE_BYOK plan.
 * Shows a modal/panel when the key is missing or needs to be updated.
 */
interface BYOKKeyInputProps {
  onKeySet?: () => void;
}

export default function BYOKKeyInput({ onKeySet }: BYOKKeyInputProps) {
  const { plan } = useCurrentPlan();
  const { key, setKey, hasKey } = useUserOpenAIKey();
  const [inputValue, setInputValue] = useState(key || "");
  const [isVisible, setIsVisible] = useState(!hasKey);
  const [isSaving, setIsSaving] = useState(false);

  // Auto-clear BYOK key when plan is not Free
  useEffect(() => {
    if (plan !== "FREE_BYOK") {
      clearUserApiKey();
      setKey(null);
      setIsVisible(false);
    }
  }, [plan, setKey]);

  // Sync visibility with hasKey state
  useEffect(() => {
    setIsVisible(!hasKey);
    if (hasKey && key) {
      setInputValue(key);
    }
  }, [hasKey, key]);

  const handleSave = () => {
    setIsSaving(true);
    const trimmed = inputValue.trim();
    if (trimmed) {
      setKey(trimmed);
      setIsVisible(false);
      onKeySet?.();
    }
    setIsSaving(false);
  };

  const handleClear = () => {
    setKey(null);
    setInputValue("");
    setIsVisible(true);
  };

  if (!isVisible && hasKey) {
    return (
      <div className="bg-green-900/20 border border-green-700 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-green-300">OpenAI API key configured</span>
          </div>
          <button
            onClick={handleClear}
            className="text-xs text-green-400 hover:text-green-300 underline"
          >
            Change key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mb-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h3 className="text-sm font-semibold text-blue-300">OpenAI API Key Required</h3>
        </div>
        <p className="text-xs text-blue-200">
          You're using the Free (BYOK) plan. Please enter your OpenAI API key to process work orders.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="sk-..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            onClick={handleSave}
            disabled={!inputValue.trim() || isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="text-xs text-blue-300/70">
          Your key is stored locally in your browser session and never sent to our servers except for API calls. It will be cleared automatically if you upgrade to Pro or Premium.
        </p>
      </div>
    </div>
  );
}

