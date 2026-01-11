/**
 * Server-side helper to get the OpenAI API key for Pro/Premium plans.
 * 
 * DEPRECATED: This function is kept for backward compatibility but should not be used.
 * 
 * NEW ARCHITECTURE:
 * - Free plan: Uses client-side BYOK (never calls server routes)
 * - Pro/Premium: Uses server-side OPENAI_API_KEY environment variable only
 * 
 * IMPORTANT: Free plan users should NOT call server routes. They should use client-side OpenAI calls.
 * This function will reject Free plan requests.
 * 
 * @param request - The incoming request object (not used, kept for compatibility)
 * @param plan - The current plan (from getPlanFromRequest() or similar)
 * @returns The OpenAI API key to use (server-side only), or null if not available
 */
import { Plan } from "@/lib/plan";

export function getOpenAIKeyForPlan(
  request: Request,
  plan: Plan
): string | null {
  // Free plan should NOT use server routes - they use client-side BYOK
  if (plan === "FREE_BYOK") {
    // This should never be called for Free plan (server routes reject them)
    // But if it is, return null to be safe
    return null;
  }
  
  // Pro/Premium: Use server-side key only (never accept BYOK from client)
  return process.env.OPENAI_API_KEY || null;
}

