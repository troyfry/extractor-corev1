/**
 * Client-side BYOK helper for determining which OpenAI key to use.
 * 
 * NEW ARCHITECTURE (BYOK for all plans):
 * - All plans: Uses user's BYOK from sessionStorage (optional)
 * - Keys are stored in sessionStorage: suiteAutomations_openai_key
 * - AI toggle is stored in sessionStorage: suiteAutomations_ai_enabled
 * - No server-side OPENAI_API_KEY is required
 * 
 * @param plan - The current plan (not used in new architecture, kept for compatibility)
 * @returns The OpenAI API key to use, or null if not available
 */
import { getUserApiKey } from "./byok";

export function getClientOpenAIKey(plan?: string): string | null {
  // All plans now use BYOK from sessionStorage
  return getUserApiKey();
}

/**
 * Get AI enabled status from sessionStorage.
 * @returns true if AI is enabled, false otherwise
 */
export function isAiEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.sessionStorage.getItem("suiteAutomations_ai_enabled");
  return stored === "true";
}

/**
 * Set AI enabled status in sessionStorage.
 * @param enabled - Whether AI is enabled
 */
export function setAiEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) {
    window.sessionStorage.setItem("suiteAutomations_ai_enabled", "true");
  } else {
    window.sessionStorage.removeItem("suiteAutomations_ai_enabled");
  }
}

/**
 * Get headers for AI-enabled requests.
 * @returns Headers object with x-ai-enabled and x-openai-key if AI is enabled and key exists
 */
export function getAiHeaders(): HeadersInit {
  const aiEnabled = isAiEnabled();
  const apiKey = getClientOpenAIKey();
  
  const headers: HeadersInit = {};
  
  if (aiEnabled && apiKey) {
    headers["x-ai-enabled"] = "true";
    headers["x-openai-key"] = apiKey;
  }
  
  return headers;
}
