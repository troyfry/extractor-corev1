import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { getAllFmProfiles, upsertFmProfile, deleteFmProfile } from "@/lib/templates/fmProfilesSheets";
import { validateFmProfile, normalizeFmKey } from "@/lib/templates/fmProfiles";
import type { FmProfile } from "@/lib/templates/fmProfiles";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    // Plan gating: Pro/Premium only
    const plan = getPlanFromRequest(request);
    if (!hasFeature(plan, "canUseServerKey")) {
      return NextResponse.json(
        { error: "This feature requires Pro or Premium plan" },
        { status: 403 }
      );
    }

    // Get authenticated user
    const user = await getCurrentUser();
    if (!user || !user.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get Google access token
    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google authentication required. Please sign in with Google." },
        { status: 401 }
      );
    }

    // Get spreadsheet ID - check cookie first (session-based, no DB)
    const { cookies } = await import("next/headers");
    const cookieSpreadsheetId = (await cookies()).get("googleSheetsSpreadsheetId")?.value || null;
    
    // Use cookie if available, otherwise check session/JWT token, then DB
    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      // Then check session/JWT token
      const { auth } = await import("@/auth");
      const session = await auth();
      const sessionSpreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId : null;
      spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
    }
    
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Google Sheets spreadsheet ID not configured. Please set it in Settings." },
        { status: 400 }
      );
    }

    // Get all profiles (ensure sheet exists first)
    const profiles = await getAllFmProfiles({
      spreadsheetId,
      accessToken: user.googleAccessToken,
    });

    console.log(`[FM Profiles GET] Returning ${profiles.length} profile(s)`);
    return NextResponse.json({ profiles });
  } catch (error: unknown) {
    console.error("[FM Profiles GET] Error:", error);
    
    // Check for authentication errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: number })?.code;
    if (errorMessage.includes("authentication") || 
        errorMessage.includes("Invalid Credentials") ||
        errorMessage.includes("unauthorized") ||
        errorCode === 401 ||
        errorCode === 403) {
      return NextResponse.json(
        { error: "Google authentication expired or invalid. Please sign out and sign in again to refresh your access token." },
        { status: 401 }
      );
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get profiles" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // Plan gating: Pro/Premium only
    const plan = getPlanFromRequest(request);
    if (!hasFeature(plan, "canUseServerKey")) {
      return NextResponse.json(
        { error: "This feature requires Pro or Premium plan" },
        { status: 403 }
      );
    }

    // Get authenticated user
    const user = await getCurrentUser();
    if (!user || !user.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get Google access token
    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google authentication required. Please sign in with Google." },
        { status: 401 }
      );
    }

    // Get spreadsheet ID - check cookie first (session-based, no DB)
    const { cookies } = await import("next/headers");
    const cookieSpreadsheetId = (await cookies()).get("googleSheetsSpreadsheetId")?.value || null;
    
    // Use cookie if available, otherwise check session/JWT token, then DB
    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      // Then check session/JWT token
      const { auth } = await import("@/auth");
      const session = await auth();
      const sessionSpreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId : null;
      spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
    }
    
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Google Sheets spreadsheet ID not configured. Please set it in Settings." },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const profileData = body.profile as Partial<FmProfile>;

    if (!profileData) {
      return NextResponse.json(
        { error: "Profile data is required" },
        { status: 400 }
      );
    }

    // Normalize fmKey
    if (profileData.fmKey) {
      profileData.fmKey = normalizeFmKey(profileData.fmKey);
    }

    // Validate profile
    const validationError = validateFmProfile(profileData);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    // Ensure all required fields are present
    const profile: FmProfile = {
      fmKey: profileData.fmKey!,
      fmLabel: profileData.fmLabel!,
      page: profileData.page ?? 1,
      xPct: profileData.xPct!,
      yPct: profileData.yPct!,
      wPct: profileData.wPct!,
      hPct: profileData.hPct!,
      senderDomains: profileData.senderDomains,
      subjectKeywords: profileData.subjectKeywords,
    };

    // Save profile to Sheets
    await upsertFmProfile({
      spreadsheetId,
      accessToken: user.googleAccessToken,
      profile,
    });

    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error("[FM Profiles POST] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save profile" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    // Plan gating: Pro/Premium only
    const plan = getPlanFromRequest(request);
    if (!hasFeature(plan, "canUseServerKey")) {
      return NextResponse.json(
        { error: "This feature requires Pro or Premium plan" },
        { status: 403 }
      );
    }

    // Get authenticated user
    const user = await getCurrentUser();
    if (!user || !user.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get Google access token
    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google authentication required. Please sign in with Google." },
        { status: 401 }
      );
    }

    // Get spreadsheet ID - check cookie first (session-based, no DB)
    const { cookies } = await import("next/headers");
    const cookieSpreadsheetId = (await cookies()).get("googleSheetsSpreadsheetId")?.value || null;
    
    // Use cookie if available, otherwise check session/JWT token, then DB
    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      // Then check session/JWT token
      const { auth } = await import("@/auth");
      const session = await auth();
      const sessionSpreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId : null;
      spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
    }
    
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Google Sheets spreadsheet ID not configured. Please set it in Settings." },
        { status: 400 }
      );
    }

    // Get fmKey from query params
    const { searchParams } = new URL(request.url);
    const fmKey = searchParams.get("fmKey");

    if (!fmKey) {
      return NextResponse.json(
        { error: "fmKey query parameter is required" },
        { status: 400 }
      );
    }

    // Delete profile
    await deleteFmProfile({
      spreadsheetId,
      accessToken: user.googleAccessToken,
      fmKey: normalizeFmKey(fmKey),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[FM Profiles DELETE] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete profile" },
      { status: 500 }
    );
  }
}

