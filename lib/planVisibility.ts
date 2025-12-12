/**
 * Plan Visibility Utility
 * 
 * Centralized logic for determining if Pro/Premium features should be visible.
 * Combines dev override with actual plan data.
 * 
 * TODO: When real plans are implemented, remove dev override if desired,
 * or keep it for internal testing only.
 */

import { Plan } from "./plan";
import { isDevMode } from "./env";

/**
 * Check if Pro features should be visible/accessible
 * 
 * @param currentPlan - The user's current plan
 * @returns true if Pro features should be visible (dev override OR user has Pro/Premium plan)
 */
export function canUseProFeatures(currentPlan: Plan): boolean {
  // Dev override: show all features in dev mode
  if (isDevMode) {
    return true;
  }
  
  // Production: only show if user has Pro or Premium plan
  return currentPlan === "PRO" || currentPlan === "PREMIUM";
}

/**
 * Check if Premium features should be visible/accessible
 * 
 * @param currentPlan - The user's current plan
 * @returns true if Premium features should be visible (dev override OR user has Premium plan)
 */
export function canUsePremiumFeatures(currentPlan: Plan): boolean {
  // Dev override: show all features in dev mode
  if (isDevMode) {
    return true;
  }
  
  // Production: only show if user has Premium plan
  return currentPlan === "PREMIUM";
}

/**
 * Get the effective plan for production
 * 
 * TODO: Replace this hard-coded plan with real user plan data
 * from auth/billing (e.g. Clerk + Stripe) in a future phase.
 * 
 * @returns The effective plan (FREE_BYOK in production, or actual plan in dev)
 */
export function getEffectivePlan(): Plan {
  // In production, default to Free plan
  // In dev, use the plan from context (which can be switched via PlanSelector)
  if (process.env.NODE_ENV === "production") {
    return "FREE_BYOK";
  }
  
  // In dev, return PRO as default (can be overridden by PlanSelector)
  return "PRO";
}

