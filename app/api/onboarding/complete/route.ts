/**
 * API route for completing onboarding.
 * 
 * POST /api/onboarding/complete
 * Sets onboardingCompleted to TRUE in Users sheet.
 */

import { NextResponse } from "next/server";
import { ROUTES } from "@/lib/routes";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getAllFmProfiles } from "@/lib/templates/fmProfilesSheets";
import { listTemplatesForUser } from "@/lib/templates/templatesSheets";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";
import { cookies } from "next/headers";
import { createLabelHierarchy } from "@/lib/google/gmailLabels";
import { validateLabelName } from "@/lib/google/gmailValidation";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { updateWorkspaceConfig } from "@/lib/db/services/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.userId || !user.googleAccessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get workspace ID from cookies (set during Google step)
    const cookieStore = await cookies();
    const workspaceId = cookieStore.get("workspaceId")?.value;
    const folderId = cookieStore.get("googleDriveFolderId")?.value;

    if (!workspaceId || !folderId) {
      return NextResponse.json(
        { error: "Workspace ID or folder ID not found. Please complete Google Drive setup first." },
        { status: 400 }
      );
    }

    // Get workspace from DB to verify it exists
    const { getWorkspaceById } = await import("@/lib/db/services/workspace");
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found. Please complete Google Drive setup first." },
        { status: 400 }
      );
    }

    // Gather FM profiles (normalized fmKeys) - only if export is enabled
    let normalizedFmKeys: string[] = [];
    let templatesConfigured = false;
    
    if (workspace.export_enabled && workspace.spreadsheet_id) {
      const fmProfiles = await getAllFmProfiles({
        spreadsheetId: workspace.spreadsheet_id,
        accessToken: user.googleAccessToken,
      });
      normalizedFmKeys = fmProfiles.map(p => normalizeFmKey(p.fmKey));

      // Check if templates are configured
      const templates = await listTemplatesForUser(
        user.googleAccessToken,
        workspace.spreadsheet_id,
        user.userId
      );
      templatesConfigured = templates.length > 0;
    }

    // Get base label name from request body or use default
    const body = await request.json().catch(() => ({}));
    const baseLabelName = body.baseLabelName || "Work Orders";
    const includeNeedsReview = body.includeNeedsReview === true;

    // Validate base label name (reject INBOX and other system labels)
    const baseLabelError = validateLabelName(baseLabelName);
    if (baseLabelError) {
      return NextResponse.json(
        { error: `Base Label: ${baseLabelError}` },
        { status: 400 }
      );
    }

    // Create label hierarchy (base + children)
    const labels = await createLabelHierarchy(
      user.googleAccessToken,
      baseLabelName,
      includeNeedsReview
    );

    // Save workspace config to DB (source of truth)
    await updateWorkspaceConfig(workspaceId, {
      gmailBaseLabelName: labels.base.name,
      gmailBaseLabelId: labels.base.id,
      gmailQueueLabelId: labels.queue.id,
      gmailSignedLabelId: labels.signed.id,
      gmailProcessedLabelId: labels.processed?.id || null,
      onboardingCompletedAt: new Date(),
    });
    
    // Set workspace cookies (fast path, hints only)
    const response = NextResponse.json({ success: true });
    
    // Single source cookie
    response.cookies.set("workspaceReady", "true", {
      maxAge: 30 * 24 * 60 * 60, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    // Workspace ID cookie (DB-native)
    response.cookies.set("workspaceId", workspaceId, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    // Optional cache cookies (safe hints)
    if (workspace.spreadsheet_id) {
      response.cookies.set("workspaceSpreadsheetId", workspace.spreadsheet_id, {
        maxAge: 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
    }

    response.cookies.set("workspaceDriveFolderId", folderId, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    response.cookies.set("onboardingCompletedAt", new Date().toISOString(), {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    // Set onboarding completed cookie
    response.cookies.set("onboardingCompleted", "true", {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    // Set Gmail label cookies (legacy support)
    response.cookies.set("gmailWorkOrdersLabelId", labels.queue.id, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailWorkOrdersLabelName", labels.queue.name, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailSignedLabelId", labels.signed.id, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailSignedLabelName", labels.signed.name, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    if (labels.processed) {
      response.cookies.set("gmailProcessedLabelId", labels.processed.id, {
        maxAge: 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
      response.cookies.set("gmailProcessedLabelName", labels.processed.name, {
        maxAge: 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
    }
    
    console.log(`[onboarding/complete] Workspace config saved to DB. Workspace ID: ${workspaceId}`);
    return response;
  } catch (error) {
    console.error("Error completing onboarding:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    
    // If error is about missing templates, return 400 with redirect info
    if (message.includes("crop zone") || message.includes("template") || message.includes("Templates")) {
      return NextResponse.json(
        { 
          error: message,
          redirectTo: ROUTES.onboardingTemplates,
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

