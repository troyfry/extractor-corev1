/**
 * API route for completing onboarding.
 * 
 * POST /api/onboarding/complete
 * Sets onboardingCompleted to TRUE in Users sheet.
 */

import { NextResponse } from "next/server";
import { completeOnboarding } from "@/lib/onboarding/status";
import { resetApiCallCount, getApiCallCount } from "@/lib/onboarding/usersSheet";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { saveWorkspaceConfig } from "@/lib/workspace/saveWorkspace";
import { getAllFmProfiles } from "@/lib/templates/fmProfilesSheets";
import { listTemplatesForUser } from "@/lib/templates/templatesSheets";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";
import { cookies } from "next/headers";
import { ensureLabel } from "@/lib/google/gmail";
import {
  WORK_ORDERS_LABEL_NAME,
  SIGNED_WORK_ORDERS_LABEL_NAME,
  PROCESSED_WORK_ORDERS_LABEL_NAME,
} from "@/lib/google/gmailConfig";
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

    // Get label names from request body or use defaults
    const body = await request.json().catch(() => ({}));
    const gmailWorkOrdersLabelName =
      body.gmailWorkOrdersLabelName || WORK_ORDERS_LABEL_NAME;
    const gmailSignedLabelName =
      body.gmailSignedLabelName || SIGNED_WORK_ORDERS_LABEL_NAME;
    const gmailProcessedLabelName =
      body.gmailProcessedLabelName || PROCESSED_WORK_ORDERS_LABEL_NAME;

    // Validate label names (reject INBOX and other system labels)
    const workOrdersError = validateLabelName(gmailWorkOrdersLabelName);
    if (workOrdersError) {
      return NextResponse.json(
        { error: `Work Orders Label: ${workOrdersError}` },
        { status: 400 }
      );
    }

    const signedError = validateLabelName(gmailSignedLabelName);
    if (signedError) {
      return NextResponse.json(
        { error: `Signed Label: ${signedError}` },
        { status: 400 }
      );
    }

    if (gmailProcessedLabelName) {
      const processedError = validateLabelName(gmailProcessedLabelName);
      if (processedError) {
        return NextResponse.json(
          { error: `Processed Label: ${processedError}` },
          { status: 400 }
        );
      }
    }

    // Create/ensure labels exist in Gmail
    const woLabel = await ensureLabel(user.googleAccessToken, gmailWorkOrdersLabelName);
    const signedLabel = await ensureLabel(user.googleAccessToken, gmailSignedLabelName);
    const processedLabel = await ensureLabel(user.googleAccessToken, gmailProcessedLabelName);

    // Save workspace config ONCE (source of truth)
    await saveWorkspaceConfig(user.userId, {
      spreadsheetId,
      driveFolderId: folderId,
      fmProfiles: normalizedFmKeys,
      templatesConfigured,
      onboardingCompletedAt: new Date().toISOString(),
      gmailWorkOrdersLabelName: woLabel.name,
      gmailWorkOrdersLabelId: woLabel.id,
      gmailSignedLabelName: signedLabel.name,
      gmailSignedLabelId: signedLabel.id,
      gmailProcessedLabelName: processedLabel.name,
      gmailProcessedLabelId: processedLabel.id,
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

    // Set Gmail label cookies
    response.cookies.set("gmailWorkOrdersLabelId", woLabel.id, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailWorkOrdersLabelName", woLabel.name, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailSignedLabelId", signedLabel.id, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailSignedLabelName", signedLabel.name, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailProcessedLabelId", processedLabel.id, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    response.cookies.set("gmailProcessedLabelName", processedLabel.name, {
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    
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

