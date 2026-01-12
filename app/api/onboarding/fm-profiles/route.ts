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

/**
 * GET /api/onboarding/fm-profiles
 * Get all FM profiles for the current user.
 * Returns profiles in a format suitable for dropdown selection.
 */
export async function GET() {
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

    // Get the main spreadsheet ID from cookie or session
    const cookieStore = await cookies();
    const mainSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    if (!mainSpreadsheetId) {
      // Try to get from workspace
      const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
      const workspace = await getWorkspace();
      if (workspace?.workspace.spreadsheetId) {
        const { getAllFmProfiles } = await import("@/lib/templates/fmProfilesSheets");
        const profiles = await getAllFmProfiles({
          spreadsheetId: workspace.workspace.spreadsheetId,
          accessToken: user.googleAccessToken,
        });

        // Map to response format
        const mappedProfiles = profiles.map((p) => ({
          fmKey: p.fmKey,
          displayName: p.fmLabel || p.fmKey,
          senderDomains: p.senderDomains
            ? p.senderDomains.split(",").map((d) => d.trim()).filter(Boolean)
            : [],
          senderEmails: [], // Not stored in current schema, return empty array
        }));

        return NextResponse.json({ profiles: mappedProfiles });
      }

      return NextResponse.json(
        { error: "Spreadsheet ID not configured. Please complete onboarding." },
        { status: 400 }
      );
    }

    // Get all profiles
    const { getAllFmProfiles } = await import("@/lib/templates/fmProfilesSheets");
    const profiles = await getAllFmProfiles({
      spreadsheetId: mainSpreadsheetId,
      accessToken: user.googleAccessToken,
    });

    // Map to response format
    const mappedProfiles = profiles.map((p) => ({
      fmKey: p.fmKey,
      displayName: p.fmLabel || p.fmKey,
      senderDomains: p.senderDomains
        ? p.senderDomains.split(",").map((d) => d.trim()).filter(Boolean)
        : [],
      senderEmails: [], // Not stored in current schema, return empty array
    }));

    return NextResponse.json({ profiles: mappedProfiles });
  } catch (error) {
    console.error("Error fetching FM profiles:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

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
    console.log(`[onboarding/fm-profiles] POST request body:`, JSON.stringify(body, null, 2));
    
    // Support both new format (profiles array) and legacy format (single profile)
    let profilesToSave: Array<{
      fmKey: string;
      senderDomains?: string[];
      subjectKeywords?: string[];
    }> = [];

    if (body.profiles && Array.isArray(body.profiles)) {
      // New format: array of profiles
      profilesToSave = body.profiles;
      console.log(`[onboarding/fm-profiles] Using new format: ${profilesToSave.length} profile(s)`);
    } else if (body.fmKey) {
      // Legacy format: single profile
      profilesToSave = [{
        fmKey: body.fmKey,
        senderDomains: body.senderDomains,
        subjectKeywords: body.subjectKeywords,
      }];
      console.log(`[onboarding/fm-profiles] Using legacy format: 1 profile`);
    } else {
      console.error(`[onboarding/fm-profiles] Invalid request body: missing profiles array or fmKey`);
      return NextResponse.json(
        { error: "profiles array or fmKey is required" },
        { status: 400 }
      );
    }

    if (profilesToSave.length === 0) {
      console.error(`[onboarding/fm-profiles] No profiles to save`);
      return NextResponse.json(
        { error: "At least one FM profile is required" },
        { status: 400 }
      );
    }

    // Validate all profiles have fmKey
    for (const profile of profilesToSave) {
      if (!profile.fmKey || typeof profile.fmKey !== "string" || !profile.fmKey.trim()) {
        console.error(`[onboarding/fm-profiles] Invalid profile: missing or empty fmKey`, profile);
        return NextResponse.json(
          { error: "All profiles must have a non-empty fmKey" },
          { status: 400 }
        );
      }
    }

    // Get the main spreadsheet ID from cookie (set during Google step)
    const cookieStore = await cookies();
    const mainSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
    console.log(`[onboarding/fm-profiles] Spreadsheet ID from cookie: ${mainSpreadsheetId ? "found" : "missing"}`);

    if (!mainSpreadsheetId) {
      console.error(`[onboarding/fm-profiles] Spreadsheet ID not found in cookie`);
      return NextResponse.json(
        { error: "Spreadsheet ID not configured. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Ensure Users sheet exists (onboarding route - must ensure sheet exists)
    await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId, { allowEnsure: true });

    // Check if user row exists, create if missing
    console.log(`[onboarding/fm-profiles] Checking for user row: userId=${user.userId}`);
    let userRow = await getUserRowById(user.googleAccessToken, mainSpreadsheetId, user.userId);
    if (!userRow) {
      console.log(`[onboarding/fm-profiles] User row not found, creating it for userId=${user.userId}`);
      // Create user row if it doesn't exist
      const { upsertUserRow } = await import("@/lib/onboarding/usersSheet");
      await upsertUserRow(
        user.googleAccessToken,
        mainSpreadsheetId,
        {
          userId: user.userId,
          email: user.email || "",
          spreadsheetId: mainSpreadsheetId,
          onboardingCompleted: "FALSE",
        },
        { allowEnsure: true }
      );
      // Re-fetch to verify it was created
      userRow = await getUserRowById(user.googleAccessToken, mainSpreadsheetId, user.userId);
      if (!userRow) {
        console.error(`[onboarding/fm-profiles] Failed to create user row for userId=${user.userId}`);
        return NextResponse.json(
          { error: "Failed to create user row. Please try again." },
          { status: 500 }
        );
      }
      console.log(`[onboarding/fm-profiles] ✅ User row created successfully`);
    } else {
      console.log(`[onboarding/fm-profiles] User row found`);
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

