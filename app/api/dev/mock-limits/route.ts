import { NextResponse } from "next/server";

/**
 * Mock rate limit endpoint for testing.
 * 
 * GET /api/dev/mock-limits?state=ok|daily|monthly|global
 * 
 * Returns mock limit check results for testing rate limit handling.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state") || "ok";

  switch (state) {
    case "ok":
      return NextResponse.json({ allowed: true });
    
    case "daily":
      return NextResponse.json(
        { 
          allowed: false, 
          reason: "daily",
          message: "You've reached the daily limit (10 documents per day). Create a Pro account to continue."
        },
        { status: 429 }
      );
    
    case "monthly":
      return NextResponse.json(
        { 
          allowed: false, 
          reason: "monthly",
          message: "You've reached the monthly limit (20 documents per month). Create a Pro account to continue."
        },
        { status: 429 }
      );
    
    case "global":
      return NextResponse.json(
        { 
          allowed: false, 
          reason: "global",
          message: "Free tier is temporarily paused due to high demand. Please try again next month or create a Pro account."
        },
        { status: 429 }
      );
    
    default:
      return NextResponse.json(
        { error: "Invalid state. Use: ok, daily, monthly, or global" },
        { status: 400 }
      );
  }
}
