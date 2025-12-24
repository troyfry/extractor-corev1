/**
 * API route for completing onboarding.
 * 
 * POST /api/onboarding/complete
 * Sets onboardingCompleted to TRUE in Users sheet.
 */

import { NextResponse } from "next/server";
import { completeOnboarding } from "@/lib/onboarding/status";
import { resetApiCallCount, getApiCallCount } from "@/lib/onboarding/usersSheet";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  resetApiCallCount();
  try {
    // Get spreadsheet ID from cookie (set during Google step)
    const cookieStore = await cookies();
    const spreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || undefined;
    
    await completeOnboarding(spreadsheetId);
    
    // Set onboardingCompleted cookie (30 days TTL)
    const response = NextResponse.json({ success: true });
    response.cookies.set("onboardingCompleted", "true", {
      maxAge: 30 * 24 * 60 * 60, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    
    const apiCalls = getApiCallCount();
    console.log(`[onboarding/complete] Sheets API calls: ${apiCalls}, cookie set`);
    return response;
  } catch (error) {
    console.error("Error completing onboarding:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    
    // If error is about missing templates, return 400 with redirect info
    if (message.includes("crop zone") || message.includes("template") || message.includes("Templates")) {
      return NextResponse.json(
        { 
          error: message,
          redirectTo: "/onboarding/templates",
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

