"use client";

import React, { useState, useEffect } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import BYOKKeyInput from "@/components/plan/BYOKKeyInput";
import PlanBanner from "@/components/plan/PlanBanner";
import { useCurrentPlan } from "@/lib/plan-context";
import { useUserOpenAIKey } from "@/lib/useUserOpenAIKey";
import { requiresBYOK, usesServerKey, getPlanLabel } from "@/lib/plan-helpers";
import { useRouter } from "next/navigation";

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export default function SettingsPage() {
  const { plan } = useCurrentPlan();
  const { key: openaiKey, hasKey } = useUserOpenAIKey();
  const router = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
  
  // Google Sheets configuration state
  const [folderName, setFolderName] = useState<string>("");
  const [sheetName, setSheetName] = useState<string>("");
  const [spreadsheetId, setSpreadsheetId] = useState<string>("");
  const [folderId, setFolderId] = useState<string>("");
  const [isLoadingSpreadsheet, setIsLoadingSpreadsheet] = useState(true);
  const [isSavingSpreadsheet, setIsSavingSpreadsheet] = useState(false);
  const [spreadsheetStatus, setSpreadsheetStatus] = useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });
  
  // Dropdown states
  const [showSheetDropdown, setShowSheetDropdown] = useState(false);
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [sheetSearchTerm, setSheetSearchTerm] = useState("");
  const [folderSearchTerm, setFolderSearchTerm] = useState("");
  const [availableSheets, setAvailableSheets] = useState<Array<{ id: string; name: string }>>([]);
  const [availableFolders, setAvailableFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // Load workspace info on mount
  useEffect(() => {
    const loadWorkspaceInfo = async () => {
      try {
        const response = await fetch("/api/user-settings/workspace-info");
        if (response.ok) {
          const data = await response.json();
          setFolderName(data.folderName || "");
          setSheetName(data.sheetName || "");
          setSpreadsheetId(data.spreadsheetId || "");
          setFolderId(data.folderId || "");
        }
      } catch (error) {
        console.error("Error loading workspace info:", error);
      } finally {
        setIsLoadingSpreadsheet(false);
      }
    };

    loadWorkspaceInfo();
  }, []);

  // Load available spreadsheets when dropdown opens
  useEffect(() => {
    if (showSheetDropdown && availableSheets.length === 0) {
      loadAvailableSheets();
    }
  }, [showSheetDropdown]);

  // Load available folders when dropdown opens
  useEffect(() => {
    if (showFolderDropdown && availableFolders.length === 0) {
      loadAvailableFolders();
    }
  }, [showFolderDropdown]);

  // Search spreadsheets when search term changes
  useEffect(() => {
    if (showSheetDropdown && sheetSearchTerm) {
      const timeoutId = setTimeout(() => {
        loadAvailableSheets(sheetSearchTerm);
      }, 300); // Debounce search
      return () => clearTimeout(timeoutId);
    } else if (showSheetDropdown) {
      loadAvailableSheets();
    }
  }, [sheetSearchTerm, showSheetDropdown]);

  // Search folders when search term changes
  useEffect(() => {
    if (showFolderDropdown && folderSearchTerm) {
      const timeoutId = setTimeout(() => {
        loadAvailableFolders(folderSearchTerm);
      }, 300); // Debounce search
      return () => clearTimeout(timeoutId);
    } else if (showFolderDropdown) {
      loadAvailableFolders();
    }
  }, [folderSearchTerm, showFolderDropdown]);

  const loadAvailableSheets = async (searchTerm: string = "") => {
    setIsLoadingSheets(true);
    try {
      const response = await fetch(`/api/user-settings/list-spreadsheets?q=${encodeURIComponent(searchTerm)}`);
      if (response.ok) {
        const data = await response.json();
        setAvailableSheets(data.spreadsheets || []);
      }
    } catch (error) {
      console.error("Error loading spreadsheets:", error);
    } finally {
      setIsLoadingSheets(false);
    }
  };

  const loadAvailableFolders = async (searchTerm: string = "") => {
    setIsLoadingFolders(true);
    try {
      const response = await fetch(`/api/user-settings/list-folders?q=${encodeURIComponent(searchTerm)}`);
      if (response.ok) {
        const data = await response.json();
        setAvailableFolders(data.folders || []);
      }
    } catch (error) {
      console.error("Error loading folders:", error);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const handleSelectSheet = (sheet: { id: string; name: string }) => {
    setSheetName(sheet.name);
    setSpreadsheetId(sheet.id);
    setShowSheetDropdown(false);
    setSheetSearchTerm("");
  };

  const handleSelectFolder = (folder: { id: string; name: string }) => {
    setFolderName(folder.name);
    setFolderId(folder.id);
    setShowFolderDropdown(false);
    setFolderSearchTerm("");
  };

  // Load token usage after hydration to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== "undefined") {
      const loadTokenUsage = () => {
        const stored = localStorage.getItem("tokenUsage");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            setTokenUsage({
              promptTokens: parsed.promptTokens || 0,
              completionTokens: parsed.completionTokens || 0,
              totalTokens: parsed.totalTokens || 0,
            });
          } catch {
            // Invalid JSON, use defaults
            setTokenUsage({
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            });
          }
        }
      };

      loadTokenUsage();
      setIsHydrated(true);

      // Listen for storage events to update token usage when other tabs update it
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === "tokenUsage") {
          loadTokenUsage();
        }
      };

      // Listen for custom events (same-tab updates)
      const handleCustomStorage = () => {
        loadTokenUsage();
      };

      window.addEventListener("storage", handleStorageChange);
      window.addEventListener("token-usage-updated", handleCustomStorage);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener("token-usage-updated", handleCustomStorage);
      };
    }
  }, []);

  const handleResetTokens = () => {
    if (
      confirm(
        "Are you sure you want to reset your token usage counter? This action cannot be undone."
      )
    ) {
      const reset: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      setTokenUsage(reset);
      if (typeof window !== "undefined") {
        localStorage.setItem("tokenUsage", JSON.stringify(reset));
        window.dispatchEvent(new Event("token-usage-updated"));
      }
    }
  };

  // Calculate estimated cost (rough estimates based on OpenAI pricing)
  const estimateCost = (tokens: number, isPrompt: boolean) => {
    // Rough estimates: gpt-4o-mini ~$0.15/$0.60 per 1M tokens (input/output)
    // Using average of both for simplicity
    const costPerMillion = isPrompt ? 0.15 : 0.6;
    return (tokens / 1_000_000) * costPerMillion;
  };

  const estimatedPromptCost = estimateCost(tokenUsage.promptTokens, true);
  const estimatedCompletionCost = estimateCost(
    tokenUsage.completionTokens,
    false
  );
  const estimatedTotalCost = estimatedPromptCost + estimatedCompletionCost;

  // Handle saving workspace info (create new workspace)
  const handleSaveWorkspace = async () => {
    if (!folderName.trim() || !sheetName.trim()) {
      setSpreadsheetStatus({
        type: "error",
        message: "Folder name and sheet name are required",
      });
      return;
    }

    setIsSavingSpreadsheet(true);
    setSpreadsheetStatus({ type: null, message: "" });

    try {
      // Create or update workspace
      const response = await fetch("/api/onboarding/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folderName: folderName.trim(),
          sheetName: sheetName.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSpreadsheetStatus({
          type: "success",
          message: "Workspace configured successfully ✅",
        });
        // Reload workspace info to get updated IDs
        const infoResponse = await fetch("/api/user-settings/workspace-info");
        if (infoResponse.ok) {
          const infoData = await infoResponse.json();
          setFolderName(infoData.folderName || "");
          setSheetName(infoData.sheetName || "");
          setSpreadsheetId(infoData.spreadsheetId || "");
          setFolderId(infoData.folderId || "");
        }
        // Clear status after 5 seconds
        setTimeout(() => {
          setSpreadsheetStatus({ type: null, message: "" });
        }, 5000);
      } else {
        setSpreadsheetStatus({
          type: "error",
          message: data.error || "Failed to configure workspace",
        });
      }
    } catch (error) {
      setSpreadsheetStatus({
        type: "error",
        message: "Network error. Please try again.",
      });
    } finally {
      setIsSavingSpreadsheet(false);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is outside both dropdowns
      const sheetInput = document.getElementById("sheet-name");
      const folderInput = document.getElementById("folder-name");
      const isClickInsideSheet = sheetInput?.contains(target) || target.closest("#sheet-name") !== null;
      const isClickInsideFolder = folderInput?.contains(target) || target.closest("#folder-name") !== null;
      
      if (!isClickInsideSheet && !isClickInsideFolder) {
        setShowSheetDropdown(false);
        setShowFolderDropdown(false);
      }
    };
    
    if (showSheetDropdown || showFolderDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSheetDropdown, showFolderDropdown]);

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <h1 className="text-2xl font-semibold text-white">Settings</h1>
          </div>
          <p className="text-gray-400">
            Manage your account settings, API keys, and view usage statistics.
          </p>
        </div>

        <div className="space-y-6">
          {/* Plan Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              Subscription Plan
            </h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">{getPlanLabel(plan)}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {plan === "FREE_BYOK"
                    ? "Free plan with some limits"
                    : plan === "PRO"
                    ? "Professional plan with server-side AI processing"
                    : "Premium plan with all features"}
                </p>
              </div>
              {plan !== "PREMIUM" && (
                <button
                  onClick={() => alert("Upgrade functionality coming soon!")}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium text-sm transition-colors"
                >
                  Upgrade
                </button>
              )}
            </div>
          </div>

          {/* Account Information */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              Account Information
            </h2>
            <div className="space-y-3 text-gray-300">
              <div>
                <span className="font-medium text-white">Version:</span> v2.0.0
              </div>
              <div>
                <span className="font-medium text-white">Plan:</span>{" "}
                {getPlanLabel(plan)}
              </div>
              <div className="pt-2 border-t border-gray-700">
                <p className="text-sm text-gray-400">
                  This tool helps you extract structured work order data from
                  emails and PDFs. All processing happens in real-time and data
                  is not stored on our servers.
                </p>
              </div>
            </div>
          </div>

          {/* OpenAI API Key Configuration */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              AI Parsing (Optional)
            </h2>
            <BYOKKeyInput />
          </div>

          {/* Google Workspace Configuration */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Google Workspace
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <label
                  htmlFor="folder-name"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Drive Folder
                </label>
                <div className="relative">
                  <input
                    id="folder-name"
                    type="text"
                    value={folderName}
                    onChange={(e) => {
                      setFolderName(e.target.value);
                      setFolderId(""); // Clear ID when typing new name
                    }}
                    onFocus={() => setShowFolderDropdown(true)}
                    placeholder="Work Orders"
                    disabled={isLoadingSpreadsheet || isSavingSpreadsheet}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {showFolderDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                      <div className="p-2 border-b border-gray-700">
                        <input
                          type="text"
                          value={folderSearchTerm}
                          onChange={(e) => setFolderSearchTerm(e.target.value)}
                          placeholder="Search folders..."
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      </div>
                      {isLoadingFolders ? (
                        <div className="p-4 text-center text-gray-400 text-sm">Loading...</div>
                      ) : availableFolders.length > 0 ? (
                        <div className="py-1">
                          {availableFolders.map((folder) => (
                            <button
                              key={folder.id}
                              type="button"
                              onClick={() => handleSelectFolder(folder)}
                              className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm transition-colors"
                            >
                              {folder.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-gray-400 text-sm">
                          {folderSearchTerm ? "No folders found" : "Type to search or create new"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-400">
                  Select an existing folder or type a new name to create one. PDFs and snippets are stored here.
                </p>
              </div>

              <div className="relative">
                <label
                  htmlFor="sheet-name"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Spreadsheet
                </label>
                <div className="relative">
                  <input
                    id="sheet-name"
                    type="text"
                    value={sheetName}
                    onChange={(e) => {
                      setSheetName(e.target.value);
                      setSpreadsheetId(""); // Clear ID when typing new name
                    }}
                    onFocus={() => setShowSheetDropdown(true)}
                    placeholder="Work Order Workspace"
                    disabled={isLoadingSpreadsheet || isSavingSpreadsheet}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {showSheetDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                      <div className="p-2 border-b border-gray-700">
                        <input
                          type="text"
                          value={sheetSearchTerm}
                          onChange={(e) => setSheetSearchTerm(e.target.value)}
                          placeholder="Search spreadsheets..."
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      </div>
                      {isLoadingSheets ? (
                        <div className="p-4 text-center text-gray-400 text-sm">Loading...</div>
                      ) : availableSheets.length > 0 ? (
                        <div className="py-1">
                          {availableSheets.map((sheet) => (
                            <button
                              key={sheet.id}
                              type="button"
                              onClick={() => handleSelectSheet(sheet)}
                              className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm transition-colors"
                            >
                              {sheet.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-gray-400 text-sm">
                          {sheetSearchTerm ? "No spreadsheets found" : "Type to search or create new"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-400">
                  Select an existing spreadsheet or type a new name to create one. This is where work orders are tracked.
                </p>
              </div>

              {spreadsheetStatus.type && (
                <div
                  className={`p-3 rounded-lg ${
                    spreadsheetStatus.type === "success"
                      ? "bg-green-900/30 border border-green-700 text-green-300"
                      : "bg-red-900/30 border border-red-700 text-red-300"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {spreadsheetStatus.type === "success" ? (
                      <svg
                        className="w-5 h-5 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5 mt-0.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    )}
                    <div className="flex-1">
                      <p className="font-medium">
                        {spreadsheetStatus.type === "success"
                          ? "Success"
                          : "Error"}
                      </p>
                      <p className="text-sm mt-1 whitespace-pre-line">
                        {spreadsheetStatus.message}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleSaveWorkspace}
                disabled={isLoadingSpreadsheet || isSavingSpreadsheet}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSavingSpreadsheet ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Saving...
                  </>
                ) : (
                  "Save Workspace"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
