/**
 * Get user tier from authenticated session.
 * 
 * TODO: Replace with real implementation that reads from:
 * - User session/billing system
 * - Clerk user metadata
 * - Stripe subscription status
 * 
 * For now, returns PRO as default for authenticated users.
 * 
 * @returns User tier: "free" | "pro" | "premium"
 */
import { getCurrentUser } from "@/lib/auth/currentUser";

export type UserTier = "free" | "pro" | "premium";

export async function getUserTier(): Promise<UserTier> {
  const user = await getCurrentUser();
  
  if (!user) {
    // Not authenticated - should not reach here in protected routes
    return "free";
  }

  // TODO: Replace with actual tier lookup from billing/subscription system
  // For now, default to PRO for authenticated users
  // In production, this should query:
  // - Clerk user metadata for tier
  // - Stripe subscription status
  // - Database user record
  
  return "pro";
}

