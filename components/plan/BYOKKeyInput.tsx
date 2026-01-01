"use client";

import React, { useState, useEffect } from "react";
import { useUserOpenAIKey } from "@/lib/useUserOpenAIKey";
import { isAiEnabled, setAiEnabled } from "@/lib/byok-client";

/**
 * Component for entering and managing OpenAI API key (optional for all plans).
 * AI is now optional - users can enable/disable it and provide their own key.
 */
interface BYOKKeyInputProps {
  onKeySet?: () => void;
}

export default function BYOKKeyInput({ onKeySet }: BYOKKeyInputProps) {
  const { key, setKey, hasKey } = useUserOpenAIKey();
  const [inputValue, setInputValue] = useState(key || "");
  const [isVisible, setIsVisible] = useState(!hasKey);
  const [isSaving, setIsSaving] = useState(false);
  const [aiToggle, setAiToggle] = useState(isAiEnabled());

  // Sync AI toggle with sessionStorage
  useEffect(() => {
    setAiToggle(isAiEnabled());
  }, []);

  const handleAiToggle = (enabled: boolean) => {
    setAiEnabled(enabled);
    setAiToggle(enabled);
  };

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
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-green-300">OpenAI API key configured</span>
            </div>
            <button
              onClick={handleClear}
              className="text-xs text-slate-400 hover:text-slate-300 underline"
            >
              Change key
            </button>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={aiToggle}
                onChange={(e) => handleAiToggle(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-300">Enable AI parsing</span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h3 className="text-sm font-semibold text-slate-300">AI Parsing (Optional)</h3>
        </div>
        <p className="text-xs text-slate-400">
          AI parsing is optional. You can provide your own OpenAI API key to enable AI-powered extraction, or leave it disabled to use rule-based parsing only.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="sk-... (optional)"
            className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button
            onClick={handleSave}
            disabled={!inputValue.trim() || isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
        {hasKey && (
          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={aiToggle}
                onChange={(e) => handleAiToggle(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-300">Enable AI parsing</span>
            </label>
          </div>
        )}
        <p className="text-xs text-slate-500">
          Your key is stored locally in your browser session and never sent to our servers except for API calls. You can disable AI anytime.
        </p>
      </div>
    </div>
  );
}

