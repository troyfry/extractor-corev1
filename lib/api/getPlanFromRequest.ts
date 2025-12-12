/**
 * Server-side helper to get the current plan from the request.
 * 
 * IMPORTANT: This is currently a development-only implementation.
 * 
 * For now, reads from x-plan header (set by client).
 * In production, this will be determined from the user's session/billing.
 * 
 * TODO: Replace with server-side plan resolution:
 * - Read plan from authenticated user's session
 * - Query billing/subscription system for user's actual plan
 * - Remove dependency on x-plan header
 * 
 * @param request - The incoming request object
 * @returns The current plan, defaults to PRO if not specified
 */
import { Plan, getDefaultPlan } from "@/lib/plan";
import { isValidPlan } from "@/lib/plan-helpers";

export function getPlanFromRequest(request: Request): Plan {
  const planHeader = request.headers.get("x-plan");
  if (planHeader && isValidPlan(planHeader)) {
    return planHeader;
  }
  // Default to PRO for backward compatibility
  return getDefaultPlan();
}

