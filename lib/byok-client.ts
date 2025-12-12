/**
 * Client-side BYOK helper for determining which OpenAI key to use.
 * 
 * Free plan: Uses user's BYOK from sessionStorage
 * Pro/Premium: Returns null (should use server-side key via API routes)
 */

import { Plan } from "./plan";
import { getUserApiKey } from "./byok";

/**
 * Get the effective OpenAI key for client-side use.
 * 
 * Free plan: Returns user's BYOK from sessionStorage
 * Pro/Premium: Returns null (client should NOT have access to server key)
 * 
 * @param plan - The current plan
 * @returns The OpenAI key to use on client, or null if not available/should use server
 */
export function getEffectiveClientOpenAIKey(plan: Plan): string | null {
  if (plan === "FREE_BYOK") {
    // Free plan → use user's BYOK from session storage
    return getUserApiKey();
  }

  // Pro/Premium → client should NOT have access to the server key
  // These plans should call server API routes instead
  return null;
}

