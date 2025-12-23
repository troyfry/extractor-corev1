/**
 * API route for completing onboarding.
 * 
 * POST /api/onboarding/complete
 * Sets onboardingCompleted to TRUE in Users sheet.
 */

import { NextResponse } from "next/server";
import { completeOnboarding } from "@/lib/onboarding/status";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Get spreadsheet ID from cookie (set during Google step)
    const cookieStore = await cookies();
    const spreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || undefined;
    
    await completeOnboarding(spreadsheetId);
    
    // The spreadsheet ID is already stored in the cookie (set during Google step)
    // The JWT callback will read from cookies on the next request and store it in the token
    // This ensures persistence across logins
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error completing onboarding:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

