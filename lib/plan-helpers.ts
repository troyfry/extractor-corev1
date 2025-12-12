/**
 * Plan Helper Functions
 * 
 * Utility functions to check plan types and reduce duplication of plan === "X" checks.
 * Use these helpers instead of direct plan comparisons throughout the codebase.
 */

import { Plan, hasFeature, featuresByPlan } from "./plan";

/**
 * Check if the current plan is Free
 */
export function isFreePlan(plan: Plan): boolean {
  return plan === "FREE_BYOK";
}

/**
 * Check if the current plan is PRO
 */
export function isProPlan(plan: Plan): boolean {
  return plan === "PRO";
}

/**
 * Check if the current plan is PREMIUM
 */
export function isPremiumPlan(plan: Plan): boolean {
  return plan === "PREMIUM";
}

/**
 * Check if the plan requires BYOK (Bring Your Own Key)
 * @deprecated BYOK functionality has been removed. Free tier now uses server-side keys.
 */
export function requiresBYOK(plan: Plan): boolean {
  return hasFeature(plan, "canUseBYOK");
}

/**
 * Check if the plan uses server-side OpenAI key
 */
export function usesServerKey(plan: Plan): boolean {
  return hasFeature(plan, "canUseServerKey");
}

/**
 * Get a human-readable label for a plan
 */
export function getPlanLabel(plan: Plan): string {
  const labels: Record<Plan, string> = {
    FREE_BYOK: "Free",
    PRO: "Pro",
    PREMIUM: "Premium",
  };
  return labels[plan];
}

/**
 * Get a short label for a plan (used in badges, etc.)
 */
export function getPlanShortLabel(plan: Plan): string {
  const labels: Record<Plan, string> = {
    FREE_BYOK: "Free",
    PRO: "Pro",
    PREMIUM: "Premium",
  };
  return labels[plan];
}

/**
 * Validate that a plan string is a valid Plan type
 */
export function isValidPlan(plan: string | null): plan is Plan {
  return plan === "FREE_BYOK" || plan === "PRO" || plan === "PREMIUM";
}

