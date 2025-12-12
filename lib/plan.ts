/**
 * Plan System
 * 
 * This module defines the subscription plan types and feature flags for the work order extractor app.
 * Plans determine which features are available to users.
 * 
 * IMPORTANT: Plan resolution is currently mocked/development-only.
 * 
 * TODO: Replace with real auth/billing integration:
 * - getCurrentPlan() should read from user session/billing system
 * - Remove dev-only plan switching (localStorage-based)
 * - Wire to actual subscription management
 * 
 * Plans:
 * - FREE_BYOK: Free tier with Bring Your Own Key (BYOK) support
 * - PRO: Professional tier with server-side AI processing and advanced features
 * - PREMIUM: Premium tier with all features including customer portal and integrations
 */

/**
 * Plan type representing the available subscription tiers
 */
export type Plan = "FREE_BYOK" | "PRO" | "PREMIUM";

/**
 * Feature flags that can be enabled/disabled per plan
 */
export type FeatureFlags = {
  canUseBYOK: boolean;
  canUseServerKey: boolean;
  canUseGmailImport: boolean;
  canUseSignedCopyMatching: boolean;
  canUseInvoices: boolean;
  canUseCustomerPortal: boolean;
  canUseIntegrations: boolean;
};

/**
 * Feature map that defines which features are available for each plan.
 * This object maps each Plan to its corresponding FeatureFlags configuration.
 */
export const featuresByPlan: Record<Plan, FeatureFlags> = {
  FREE_BYOK: {
    canUseBYOK: true,
    canUseServerKey: false,
    canUseGmailImport: false,
    canUseSignedCopyMatching: false,
    canUseInvoices: false,
    canUseCustomerPortal: false,
    canUseIntegrations: false,
  },
  PRO: {
    canUseBYOK: false,
    canUseServerKey: true,
    canUseGmailImport: true,
    canUseSignedCopyMatching: true,
    canUseInvoices: false,
    canUseCustomerPortal: false,
    canUseIntegrations: false,
  },
  PREMIUM: {
    canUseBYOK: false,
    canUseServerKey: true,
    canUseGmailImport: true,
    canUseSignedCopyMatching: true,
    canUseInvoices: true,
    canUseCustomerPortal: true,
    canUseIntegrations: true,
  },
};

/**
 * Returns the default plan for the application.
 * 
 * TODO: Replace this hard-coded plan with real user plan data
 * from auth/billing (e.g. Clerk + Stripe) in a future phase.
 * 
 * In production, defaults to FREE_BYOK (Free plan).
 * In development, defaults to PRO for testing.
 * 
 * @returns The default plan type
 */
export function getDefaultPlan(): Plan {
  // In production, default to Free plan
  if (process.env.NODE_ENV === "production") {
    return "FREE_BYOK";
  }
  // In development, default to Pro for testing
  return "PRO";
}

/**
 * Returns the current plan for the active user/session.
 * 
 * IMPORTANT: This is currently a placeholder that returns the default plan.
 * 
 * TODO: Replace with real implementation:
 * - Accept userId or session parameter
 * - Query billing/subscription system for user's actual plan
 * - Cache plan in session to avoid repeated queries
 * - Handle plan changes/upgrades gracefully
 * 
 * @returns The current plan type (currently defaults to PRO)
 */
export function getCurrentPlan(): Plan {
  // TODO: Replace with: return getPlanFromBilling(userId);
  return getDefaultPlan();
}

/**
 * Checks if a specific feature is available for a given plan.
 * 
 * @param plan - The plan to check features for
 * @param featureKey - The feature flag key to check
 * @returns true if the feature is enabled for the plan, false otherwise
 */
export function hasFeature(plan: Plan, featureKey: keyof FeatureFlags): boolean {
  return featuresByPlan[plan][featureKey];
}

