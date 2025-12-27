/**
 * API route for checking onboarding status.
 * 
 * GET /api/onboarding/status
 * Returns: { onboardingCompleted: boolean }
 */

import { NextResponse } from "next/server";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { resetApiCallCount, getApiCallCount } from "@/lib/onboarding/usersSheet";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  // Check for degraded status cookie - if set, skip Sheets calls and return cached state
  try {
    const cookieStore = await cookies();
    const degraded = cookieStore.get("onboardingStatusDegraded")?.value;
    const onboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
    
    if (degraded === "true") {
      console.log("[onboarding/status] Status degraded - returning cookie-based state without Sheets calls");
      return NextResponse.json({
        onboardingCompleted: onboardingCompleted === "true",
        isAuthenticated: true,
        degraded: true,
      });
    }
  } catch (error) {
    // Continue if cookie check fails
  }
  
  resetApiCallCount();
  try {
    const status = await getOnboardingStatus();
    const apiCalls = getApiCallCount();
    console.log(`[onboarding/status] Sheets API calls: ${apiCalls}`);
    return NextResponse.json({
      onboardingCompleted: status.onboardingCompleted,
      isAuthenticated: status.isAuthenticated,
    });
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    // On error, assume not completed (safer)
    return NextResponse.json({
      onboardingCompleted: false,
      isAuthenticated: false,
    });
  }
}

