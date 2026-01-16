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
import { ensureFmProfileSheet, upsertFmProfile as upsertFmProfileSheets, deleteFmProfile as deleteFmProfileSheets } from "@/lib/templates/fmProfilesSheets";
import { cookies } from "next/headers";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getWorkspaceById } from "@/lib/db/services/workspace";
import { upsertFmProfile, deleteFmProfile } from "@/lib/db/services/fmProfiles";

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

    // Get workspace ID (DB-native)
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      // Return empty list instead of error - user may not have completed onboarding yet
      return NextResponse.json({ profiles: [] });
    }

    // Get profiles from DB
    const { listFmProfiles } = await import("@/lib/db/services/fmProfiles");
    const dbProfiles = await listFmProfiles(workspaceId);

    // Calculate completeness for each profile
    const { calculateFmProfileCompleteness } = await import("@/lib/signed/fieldAuthorityPolicy");

    // Map to response format with completeness info
    const mappedProfiles = dbProfiles.map((p) => {
      const woNumberRegion = p.wo_number_region as {
        page?: number;
        xPct?: number;
        yPct?: number;
        wPct?: number;
        hPct?: number;
        xPt?: number;
        yPt?: number;
        wPt?: number;
        hPt?: number;
        pageWidthPt?: number;
        pageHeightPt?: number;
      } | null;

      const completeness = calculateFmProfileCompleteness({
        // Point-based coordinates (preferred - from template save)
        xPt: woNumberRegion?.xPt,
        yPt: woNumberRegion?.yPt,
        wPt: woNumberRegion?.wPt,
        hPt: woNumberRegion?.hPt,
        pageWidthPt: woNumberRegion?.pageWidthPt,
        pageHeightPt: woNumberRegion?.pageHeightPt,
        // Percentage-based coordinates (fallback - from FM_Profiles sheet)
        xPct: woNumberRegion?.xPct,
        yPct: woNumberRegion?.yPct,
        wPct: woNumberRegion?.wPct,
        hPct: woNumberRegion?.hPct,
        page: woNumberRegion?.page || 0,
        senderDomains: Array.isArray(p.sender_domains)
          ? p.sender_domains.join(",")
          : null,
      });

      return {
        fmKey: p.fm_key,
        displayName: p.display_name || p.fm_key,
        fmLabel: p.display_name || p.fm_key, // For backward compatibility
        senderDomains: Array.isArray(p.sender_domains)
          ? p.sender_domains
          : [],
        senderEmails: Array.isArray(p.sender_emails)
          ? p.sender_emails
          : [],
        // Completeness info for UI badges
        completeness: {
          score: completeness.score,
          hasWoNumberRegion: completeness.hasWoNumberRegion,
          hasPage: completeness.hasPage,
          hasSenderDomains: completeness.hasSenderDomains,
          completeness: completeness.completeness,
        },
      };
    });

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

    // Get workspace ID (DB-native)
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      console.error(`[onboarding/fm-profiles] Workspace ID not found`);
      return NextResponse.json(
        { error: "Workspace not found. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Get workspace to check if export is enabled
    const workspace = await getWorkspaceById(workspaceId);
    const exportEnabled = workspace?.export_enabled === true;
    const mainSpreadsheetId = workspace?.spreadsheet_id || null;

    // Save all profiles to DB
    console.log(`[onboarding/fm-profiles] Saving ${profilesToSave.length} profile(s) to DB for workspace: ${workspaceId}`);
    for (let i = 0; i < profilesToSave.length; i++) {
      const profileData = profilesToSave[i];
      
      console.log(`[onboarding/fm-profiles] Saving profile ${i + 1}/${profilesToSave.length}: fmKey="${profileData.fmKey}"`);
      
      // Save to DB
      // Check if profile already exists to preserve coordinates
      const { listFmProfiles } = await import("@/lib/db/services/fmProfiles");
      const existingProfiles = await listFmProfiles(workspaceId);
      const existingProfile = existingProfiles.find(p => p.fm_key.toLowerCase() === profileData.fmKey.toLowerCase().trim());

      const profileInput: {
        workspaceId: string;
        fmKey: string;
        displayName?: string | null;
        senderDomains?: string[] | null;
        senderEmails?: string[] | null;
        subjectKeywords?: string[] | null;
        woNumberRegion?: any;
      } = {
        workspaceId,
        fmKey: profileData.fmKey.trim(),
        displayName: profileData.fmKey.trim(),
        senderDomains: Array.isArray(profileData.senderDomains)
          ? profileData.senderDomains
          : profileData.senderDomains
          ? [profileData.senderDomains]
          : null,
        senderEmails: null, // Not provided in onboarding
        subjectKeywords: Array.isArray(profileData.subjectKeywords)
          ? profileData.subjectKeywords
          : profileData.subjectKeywords
          ? [profileData.subjectKeywords]
          : null,
        // Only set woNumberRegion to null for new profiles, preserve for existing ones
        ...(existingProfile ? {} : { woNumberRegion: null }), // Will be set in templates step for new profiles
      };

      await upsertFmProfile(profileInput);
      
      console.log(`[onboarding/fm-profiles] ✅ Saved profile ${i + 1}/${profilesToSave.length} to DB: fmKey="${profileData.fmKey}"`);

      // If export is enabled, also save to Sheets
      if (exportEnabled && mainSpreadsheetId) {
        try {
          // Ensure Users sheet exists
          await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId, { allowEnsure: true });

          // Check if user row exists, create if missing
          let userRow = await getUserRowById(user.googleAccessToken, mainSpreadsheetId, user.userId);
          if (!userRow) {
            console.log(`[onboarding/fm-profiles] Creating user row for Sheets export`);
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
          }

          // Ensure FM_Profiles sheet exists
          await ensureFmProfileSheet(mainSpreadsheetId, user.googleAccessToken);

          // Save to Sheets
          const profile = {
            fmKey: profileData.fmKey.toLowerCase().trim(),
            fmLabel: profileData.fmKey.trim(),
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

          await upsertFmProfileSheets({
            spreadsheetId: mainSpreadsheetId,
            accessToken: user.googleAccessToken,
            profile,
            userId: user.userId,
          });
          console.log(`[onboarding/fm-profiles] ✅ Saved profile ${i + 1}/${profilesToSave.length} to Sheets: fmKey="${profile.fmKey}"`);
        } catch (sheetsError) {
          // Log but don't fail - DB is the source of truth
          console.warn(`[onboarding/fm-profiles] Failed to save profile to Sheets (non-blocking):`, sheetsError);
        }
      }
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

/**
 * PATCH /api/onboarding/fm-profiles
 * Update a single FM profile.
 */
export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { fmKey, senderDomains, subjectKeywords, displayName } = body;

    if (!fmKey || typeof fmKey !== "string" || !fmKey.trim()) {
      return NextResponse.json(
        { error: "fmKey is required" },
        { status: 400 }
      );
    }

    // Get workspace ID
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Get existing profile to preserve wo_number_region
    const { listFmProfiles } = await import("@/lib/db/services/fmProfiles");
    const existingProfiles = await listFmProfiles(workspaceId);
    const existing = existingProfiles.find(p => p.fm_key.toLowerCase() === fmKey.toLowerCase().trim());

    // Update profile (preserve wo_number_region by not passing it - upsertFmProfile will preserve it)
    const updateInput: {
      workspaceId: string;
      fmKey: string;
      displayName?: string | null;
      senderDomains?: string[] | null;
      subjectKeywords?: string[] | null;
      woNumberRegion?: any;
    } = {
      workspaceId,
      fmKey: fmKey.trim(),
      displayName: displayName || fmKey.trim(),
      senderDomains: Array.isArray(senderDomains)
        ? senderDomains
        : senderDomains
        ? [senderDomains]
        : null,
      subjectKeywords: Array.isArray(subjectKeywords)
        ? subjectKeywords
        : subjectKeywords
        ? [subjectKeywords]
        : null,
      // Don't pass woNumberRegion at all - this tells upsertFmProfile to preserve existing coordinates
    };

    await upsertFmProfile(updateInput);

    // If export is enabled, also update Sheets
    const workspace = await getWorkspaceById(workspaceId);
    if (workspace?.export_enabled && workspace?.spreadsheet_id && user.googleAccessToken) {
      try {
        await ensureUsersSheet(user.googleAccessToken, workspace.spreadsheet_id, { allowEnsure: true });
        await ensureFmProfileSheet(workspace.spreadsheet_id, user.googleAccessToken);
        
        const profile = {
          fmKey: fmKey.toLowerCase().trim(),
          fmLabel: displayName || fmKey.trim(),
          page: existing?.wo_number_region ? (existing.wo_number_region as any).page || 1 : 1,
          xPct: existing?.wo_number_region ? (existing.wo_number_region as any).xPct || 0 : 0,
          yPct: existing?.wo_number_region ? (existing.wo_number_region as any).yPct || 0 : 0,
          wPct: existing?.wo_number_region ? (existing.wo_number_region as any).wPct || 0 : 0,
          hPct: existing?.wo_number_region ? (existing.wo_number_region as any).hPct || 0 : 0,
          senderDomains: Array.isArray(senderDomains)
            ? senderDomains.join(",")
            : senderDomains || "",
          subjectKeywords: Array.isArray(subjectKeywords)
            ? subjectKeywords.join(",")
            : subjectKeywords || "",
        };

        await upsertFmProfileSheets({
          spreadsheetId: workspace.spreadsheet_id,
          accessToken: user.googleAccessToken,
          profile,
          userId: user.userId,
        });
      } catch (sheetsError) {
        console.warn(`[onboarding/fm-profiles] Failed to update profile in Sheets (non-blocking):`, sheetsError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating FM profile:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/onboarding/fm-profiles?fmKey=...
 * Delete an FM profile.
 */
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fmKey = searchParams.get("fmKey");

    if (!fmKey) {
      return NextResponse.json(
        { error: "fmKey query parameter is required" },
        { status: 400 }
      );
    }

    // Get workspace ID
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found." },
        { status: 400 }
      );
    }

    // Delete from DB
    const deleted = await deleteFmProfile(workspaceId, fmKey);
    if (!deleted) {
      return NextResponse.json(
        { error: "FM profile not found" },
        { status: 404 }
      );
    }

    // If export is enabled, also delete from Sheets
    const workspace = await getWorkspaceById(workspaceId);
    if (workspace?.export_enabled && workspace?.spreadsheet_id && user.googleAccessToken) {
      try {
        await deleteFmProfileSheets({
          spreadsheetId: workspace.spreadsheet_id,
          accessToken: user.googleAccessToken,
          fmKey,
        });
      } catch (sheetsError) {
        console.warn(`[onboarding/fm-profiles] Failed to delete profile from Sheets (non-blocking):`, sheetsError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting FM profile:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
