/**
 * API route for saving FM profiles during onboarding.
 * 
 * POST /api/onboarding/fm-profiles
 * Body: { profiles: Array<{ fmKey: string, senderDomains?: string[], subjectKeywords?: string[] }> }
 *       OR (legacy): { fmKey: string, senderDomains?: string[], subjectKeywords?: string[] }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById, resetApiCallCount, getApiCallCount, ensureUsersSheet } from "@/lib/onboarding/usersSheet";
import { ensureFmProfileSheet, upsertFmProfile } from "@/lib/templates/fmProfilesSheets";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  resetApiCallCount();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google OAuth token not available. Please sign in again." },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Support both new format (profiles array) and legacy format (single profile)
    let profilesToSave: Array<{
      fmKey: string;
      senderDomains?: string[];
      subjectKeywords?: string[];
    }> = [];

    if (body.profiles && Array.isArray(body.profiles)) {
      // New format: array of profiles
      profilesToSave = body.profiles;
    } else if (body.fmKey) {
      // Legacy format: single profile
      profilesToSave = [{
        fmKey: body.fmKey,
        senderDomains: body.senderDomains,
        subjectKeywords: body.subjectKeywords,
      }];
    } else {
      return NextResponse.json(
        { error: "profiles array or fmKey is required" },
        { status: 400 }
      );
    }

    if (profilesToSave.length === 0) {
      return NextResponse.json(
        { error: "At least one FM profile is required" },
        { status: 400 }
      );
    }

    // Validate all profiles have fmKey
    for (const profile of profilesToSave) {
      if (!profile.fmKey || typeof profile.fmKey !== "string" || !profile.fmKey.trim()) {
        return NextResponse.json(
          { error: "All profiles must have a non-empty fmKey" },
          { status: 400 }
        );
      }
    }

    // Get the main spreadsheet ID from cookie (set during Google step)
    const cookieStore = await cookies();
    const mainSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    if (!mainSpreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not configured. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Ensure Users sheet exists (onboarding route - must ensure sheet exists)
    await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId, { allowEnsure: true });

    // Verify user row exists
    const userRow = await getUserRowById(user.googleAccessToken, mainSpreadsheetId, user.userId);
    if (!userRow) {
      return NextResponse.json(
        { error: "User row not found. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Ensure FM_Profiles sheet exists (will add userId column if needed)
    await ensureFmProfileSheet(mainSpreadsheetId, user.googleAccessToken);

    // Save all profiles
    console.log(`[onboarding/fm-profiles] Saving ${profilesToSave.length} profile(s) for userId: ${user.userId}`);
    for (let i = 0; i < profilesToSave.length; i++) {
      const profileData = profilesToSave[i];
      const profile = {
        fmKey: profileData.fmKey.toLowerCase().trim(),
        fmLabel: profileData.fmKey.trim(), // Use fmKey as label for now
        page: 1,
        xPct: 0,
        yPct: 0,
        wPct: 1,
        hPct: 1,
        senderDomains: Array.isArray(profileData.senderDomains)
          ? profileData.senderDomains.join(",")
          : (profileData.senderDomains || ""),
        subjectKeywords: Array.isArray(profileData.subjectKeywords)
          ? profileData.subjectKeywords.join(",")
          : (profileData.subjectKeywords || ""),
      };

      console.log(`[onboarding/fm-profiles] Saving profile ${i + 1}/${profilesToSave.length}: fmKey="${profile.fmKey}"`);
      await upsertFmProfile({
        spreadsheetId: mainSpreadsheetId,
        accessToken: user.googleAccessToken,
        profile,
        userId: user.userId,
      });
      console.log(`[onboarding/fm-profiles] ✅ Saved profile ${i + 1}/${profilesToSave.length}: fmKey="${profile.fmKey}"`);
    }

    const apiCalls = getApiCallCount();
    console.log(`[onboarding/fm-profiles] Sheets API calls: ${apiCalls}`);
    
    // Set fmProfilesReady cookie to mark this step as complete
    const response = NextResponse.json({
      success: true,
      saved: profilesToSave.length,
    });
    
    response.cookies.set("fmProfilesReady", "true", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    
    return response;
  } catch (error) {
    console.error("Error saving FM profiles:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

