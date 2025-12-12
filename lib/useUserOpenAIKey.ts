"use client";

import { useState, useEffect, useCallback } from "react";
import { saveUserApiKey, getUserApiKey, clearUserApiKey, hasUserApiKey } from "@/lib/byok";

/**
 * Hook to manage user's OpenAI API key in sessionStorage.
 * Used for FREE_BYOK plan where users provide their own key.
 * 
 * IMPORTANT: Keys are stored ONLY in sessionStorage (client-side) and NEVER sent to server.
 * 
 * @example
 * const { key, setKey, hasKey } = useUserOpenAIKey();
 * if (!hasKey) {
 *   // Show key input UI
 * }
 */
export function useUserOpenAIKey() {
  // Always start with null to avoid hydration mismatch
  // We'll load from sessionStorage in useEffect after hydration
  const [key, setKeyState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load key from sessionStorage after hydration (client-side only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const loadKey = () => {
        const stored = getUserApiKey();
        setKeyState(stored);
      };

      // Load initially after hydration
      loadKey();
      setIsHydrated(true);

      // Listen for storage changes (from other tabs/components)
      // Note: sessionStorage doesn't trigger storage events across tabs, but we keep this for consistency
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === "suiteAutomations_openai_key") {
          loadKey();
        }
      };

      window.addEventListener("storage", handleStorageChange);
      
      // Also listen for custom events (for same-tab updates)
      const handleCustomStorage = () => {
        loadKey();
      };

      window.addEventListener("openai-key-updated", handleCustomStorage);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener("openai-key-updated", handleCustomStorage);
      };
    }
  }, []);

  // Set key and save to sessionStorage
  const setKey = useCallback((newKey: string | null) => {
    setKeyState(newKey);
    if (typeof window !== "undefined") {
      if (newKey) {
        saveUserApiKey(newKey);
      } else {
        clearUserApiKey();
      }
      // Dispatch custom event to notify other components in the same tab
      window.dispatchEvent(new Event("openai-key-updated"));
    }
  }, []);

  // Check if key exists (use state for consistency, fallback to storage check)
  const hasKey = key !== null && key.trim().length > 0;

  return {
    key,
    setKey,
    hasKey,
  };
}

