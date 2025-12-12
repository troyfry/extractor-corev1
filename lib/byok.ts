/**
 * BYOK (Bring Your Own Key) Helper Functions
 * 
 * Client-side only helpers for managing user's OpenAI API key.
 * 
 * IMPORTANT RULES:
 * - Keys are stored ONLY in sessionStorage (client-side)
 * - Keys are NEVER sent to the server or stored in database
 * - Keys are automatically cleared when user upgrades to Pro/Premium
 */

const BYOK_STORAGE_KEY = "suiteAutomations_openai_key";

/**
 * Save user's OpenAI API key to sessionStorage.
 * Only works on the client side.
 * 
 * @param key - The OpenAI API key to save
 */
export function saveUserApiKey(key: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(BYOK_STORAGE_KEY, key);
}

/**
 * Get user's OpenAI API key from sessionStorage.
 * Only works on the client side.
 * 
 * @returns The stored API key, or null if not found
 */
export function getUserApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(BYOK_STORAGE_KEY);
}

/**
 * Clear user's OpenAI API key from sessionStorage.
 * Called automatically when user upgrades to Pro/Premium.
 * Only works on the client side.
 */
export function clearUserApiKey(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(BYOK_STORAGE_KEY);
}

/**
 * Check if user has a BYOK key stored.
 * 
 * @returns true if a key exists, false otherwise
 */
export function hasUserApiKey(): boolean {
  const key = getUserApiKey();
  return key !== null && key.trim().length > 0;
}

