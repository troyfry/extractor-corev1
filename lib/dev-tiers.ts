/**
 * Development Tiers Utility
 * 
 * Controls visibility of Pro and Premium tiers in the pricing page and other UI components.
 * 
 * Behavior:
 * - In development: All tiers visible and clickable
 * - In production: Only Free tier visible unless NEXT_PUBLIC_SHOW_DEV_TIERS=true is set
 */

/**
 * Check if dev tiers (Pro/Premium) should be shown
 */
export function shouldShowDevTiers(): boolean {
  return (
    process.env.NEXT_PUBLIC_SHOW_DEV_TIERS === "true" ||
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Check if a specific tier should be visible
 */
export function isTierVisible(tierId: "free" | "pro" | "premium"): boolean {
  if (tierId === "free") {
    return true; // Free tier is always visible
  }
  return shouldShowDevTiers();
}

/**
 * Check if a tier button should be disabled
 */
export function isTierDisabled(tierId: "free" | "pro" | "premium"): boolean {
  if (tierId === "free") {
    return false; // Free tier is always enabled
  }
  return !shouldShowDevTiers();
}

