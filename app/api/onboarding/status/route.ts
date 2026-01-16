/**
 * API route for checking onboarding status.
 * 
 * GET /api/onboarding/status
 * Returns: { onboardingCompleted: boolean, isAuthenticated: boolean }
 * 
 * DB-native: Checks DB workspace config instead of Users sheet.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getWorkspaceById } from "@/lib/db/services/workspace";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Check onboardingCompleted cookie FIRST (fast path, no DB calls)
    const cookieStore = await cookies();
    const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
    
    if (cookieOnboardingCompleted === "true") {
      return NextResponse.json({
        onboardingCompleted: true,
        isAuthenticated: true,
      });
    }

    // Check if user is authenticated
    const user = await getCurrentUser();
    if (!user || !user.userId) {
      return NextResponse.json({
        onboardingCompleted: false,
        isAuthenticated: false,
      });
    }

    // Get workspace ID
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json({
        onboardingCompleted: false,
        isAuthenticated: true,
      });
    }

    // Check DB workspace config
    const workspace = await getWorkspaceById(workspaceId);
    const onboardingCompleted = !!workspace?.onboarding_completed_at;

    return NextResponse.json({
      onboardingCompleted,
      isAuthenticated: true,
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

