/**
 * API route for checking onboarding status.
 * 
 * GET /api/onboarding/status
 * Returns: { onboardingCompleted: boolean }
 */

import { NextResponse } from "next/server";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { resetApiCallCount, getApiCallCount } from "@/lib/onboarding/usersSheet";

export const runtime = "nodejs";

export async function GET() {
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

