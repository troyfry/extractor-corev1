/**
 * API route for completing onboarding.
 * 
 * POST /api/onboarding/complete
 * Sets onboardingCompleted to TRUE in Users sheet.
 */

import { NextResponse } from "next/server";
import { ROUTES } from "@/lib/routes";
import { completeOnboarding } from "@/lib/onboarding/status";
import { resetApiCallCount, getApiCallCount } from "@/lib/onboarding/usersSheet";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { saveWorkspaceConfig } from "@/lib/workspace/saveWorkspace";
import { getAllFmProfiles } from "@/lib/templates/fmProfilesSheets";
import { listTemplatesForUser } from "@/lib/templates/templatesSheets";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";
import { cookies } from "next/headers";
import { createLabelHierarchy } from "@/lib/google/gmailLabels";
import { validateLabelName } from "@/lib/google/gmailValidation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  resetApiCallCount();
  try {
    const user = await getCurrentUser();
    if (!user || !user.userId || !user.googleAccessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get spreadsheet ID and folder ID from cookies (set during Google step)
    const cookieStore = await cookies();
    const spreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value;
    const folderId = cookieStore.get("googleDriveFolderId")?.value;

    if (!spreadsheetId || !folderId) {
      return NextResponse.json(
        { error: "Spreadsheet ID or folder ID not found. Please complete Google Sheets setup first." },
        { status: 400 }
      );
    }

    // Complete onboarding (validates prerequisites)
    await completeOnboarding(spreadsheetId);

    // Gather FM profiles (normalized fmKeys)
    const fmProfiles = await getAllFmProfiles({
      spreadsheetId,
      accessToken: user.googleAccessToken,
    });
    const normalizedFmKeys = fmProfiles.map(p => normalizeFmKey(p.fmKey));

    // Check if templates are configured
    const templates = await listTemplatesForUser(
      user.googleAccessToken,
      spreadsheetId,
      user.userId
    );
    const templatesConfigured = templates.length > 0;

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

    // Save workspace config ONCE (source of truth)
    await saveWorkspaceConfig(user.userId, {
      spreadsheetId,
      driveFolderId: folderId,
      fmProfiles: normalizedFmKeys,
      templatesConfigured,
      onboardingCompletedAt: new Date().toISOString(),
      labels,
      // Legacy fields for backward compatibility
      gmailWorkOrdersLabelName: labels.queue.name,
      gmailWorkOrdersLabelId: labels.queue.id,
      gmailSignedLabelName: labels.signed.name,
      gmailSignedLabelId: labels.signed.id,
      gmailProcessedLabelName: labels.processed?.name || null,
      gmailProcessedLabelId: labels.processed?.id || null,
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

    // Optional cache cookies (safe hints)
    response.cookies.set("workspaceSpreadsheetId", spreadsheetId, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

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
    
    const apiCalls = getApiCallCount();
    console.log(`[onboarding/complete] Workspace saved. Sheets API calls: ${apiCalls}`);
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

