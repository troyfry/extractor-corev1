/**
 * API route for getting template crop zone for an fmKey.
 * 
 * GET /api/onboarding/templates/get?fmKey=...
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById, ensureUsersSheet } from "@/lib/onboarding/usersSheet";
import { getTemplateByFmKey } from "@/lib/templates/templatesSheets";
import { cookies } from "next/headers";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { listFmProfiles } from "@/lib/db/services/fmProfiles";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/drizzle";
import { fm_profiles } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

    // Get fmKey from query params
    const { searchParams } = new URL(request.url);
    const fmKey = searchParams.get("fmKey");

    if (!fmKey) {
      return NextResponse.json(
        { error: "fmKey query parameter is required" },
        { status: 400 }
      );
    }

    // Get workspace ID (DB-native)
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json({ template: null });
    }

    // Normalize fmKey
    const { normalizeFmKey } = await import("@/lib/templates/fmProfiles");
    const normalizedFmKey = normalizeFmKey(fmKey);

    // Get FM profile from DB
    const [profile] = await db
      .select()
      .from(fm_profiles)
      .where(
        and(
          eq(fm_profiles.workspace_id, workspaceId),
          eq(fm_profiles.fm_key, normalizedFmKey)
        )
      )
      .limit(1);

    if (!profile || !profile.wo_number_region) {
      // Try Sheets fallback if export is enabled
      const { getWorkspaceById } = await import("@/lib/db/services/workspace");
      const workspace = await getWorkspaceById(workspaceId);
      const mainSpreadsheetId = workspace?.spreadsheet_id || null;

      if (mainSpreadsheetId && workspace?.export_enabled) {
        try {
          await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId, { allowEnsure: true });
          const template = await getTemplateByFmKey(
            user.googleAccessToken,
            mainSpreadsheetId,
            user.userId,
            fmKey
          );
          if (template) {
            return NextResponse.json({ template });
          }
        } catch (sheetsError) {
          console.warn("[onboarding/templates/get] Sheets fallback failed:", sheetsError);
        }
      }

      return NextResponse.json({ template: null });
    }

    // Convert DB format to template format
    const woNumberRegion = profile.wo_number_region as {
      page?: number;
      xPt?: number;
      yPt?: number;
      wPt?: number;
      hPt?: number;
      pageWidthPt?: number;
      pageHeightPt?: number;
      dpi?: number;
    };

    const template = {
      fmKey: profile.fm_key,
      page: woNumberRegion.page || 1,
      xPt: woNumberRegion.xPt || 0,
      yPt: woNumberRegion.yPt || 0,
      wPt: woNumberRegion.wPt || 0,
      hPt: woNumberRegion.hPt || 0,
      pageWidthPt: woNumberRegion.pageWidthPt || 0,
      pageHeightPt: woNumberRegion.pageHeightPt || 0,
      dpi: woNumberRegion.dpi || 200,
      coordSystem: "PDF_POINTS_TOP_LEFT", // Default for DB-stored templates
    };

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Error getting template:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

