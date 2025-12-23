/**
 * API route for checking onboarding status.
 * 
 * GET /api/onboarding/status
 * Returns: { onboardingCompleted: boolean }
 */

import { NextResponse } from "next/server";
import { getOnboardingStatus } from "@/lib/onboarding/status";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = await getOnboardingStatus();
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

