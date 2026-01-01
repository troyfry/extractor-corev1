/**
 * API route to reset onboarding progress.
 * Clears all onboarding-related cookies and redirects to onboarding start.
 * 
 * POST /api/onboarding/reset
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  try {
    // Require authentication
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    const cookieStore = await cookies();
    
    // Clear all onboarding-related cookies
    const cookiesToClear = [
      "onboardingCompleted",
      "workspaceReady",
      "openaiReady",
      "fmProfilesReady",
      "googleSheetsSpreadsheetId",
      "googleDriveFolderId",
      "onboardingStatusDegraded",
    ];
    
    for (const cookieName of cookiesToClear) {
      response.cookies.set(cookieName, "", {
        maxAge: 0, // delete
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/", // important: ensure deletion matches original scope
      });
    }
    
    console.log("[Onboarding Reset] Cleared all onboarding cookies");
    
    return response;
  } catch (error) {
    console.error("Error resetting onboarding:", error);
    return NextResponse.json(
      { error: "Failed to reset onboarding" },
      { status: 500 }
    );
  }
}

