import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { upsertTemplateToSheet } from "@/lib/templates/sheetsTemplates";
import type { WorkOrderTemplate } from "@/lib/templates/workOrders";

export const runtime = "nodejs";

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

    // Get spreadsheet ID
    const spreadsheetId = await getUserSpreadsheetId(user.userId);
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Google Sheets spreadsheet ID not configured. Please set it in Settings." },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const template = body.template as WorkOrderTemplate;

    if (!template || !template.issuerKey || !template.woNumberZone) {
      return NextResponse.json(
        { error: "Invalid template data" },
        { status: 400 }
      );
    }

    // Validate zone values with edge-case guards
    const zone = template.woNumberZone;
    const { xPct, yPct, wPct, hPct, page } = zone;

    // Validate page
    if (typeof page !== "number" || page < 1) {
      return NextResponse.json(
        { error: "page must be a number >= 1" },
        { status: 400 }
      );
    }

    // Validate crop zone is not default sentinel (0/0/1/1)
    const TOLERANCE = 0.01;
    const isDefault = Math.abs(xPct) < TOLERANCE && 
                      Math.abs(yPct) < TOLERANCE && 
                      Math.abs(wPct - 1) < TOLERANCE && 
                      Math.abs(hPct - 1) < TOLERANCE;

    if (isDefault) {
      return NextResponse.json(
        { 
          error: "Template crop not configured. Draw a rectangle first.",
          reason: "TEMPLATE_NOT_CONFIGURED"
        },
        { status: 400 }
      );
    }

    // Validate crop zone is not out of bounds
    if (xPct < 0 || yPct < 0 || wPct <= 0 || hPct <= 0 || xPct + wPct > 1 || yPct + hPct > 1) {
      return NextResponse.json(
        { 
          error: "Crop is out of bounds.",
          reason: "INVALID_CROP"
        },
        { status: 400 }
      );
    }

    // Validate crop zone is not too small
    const MIN_W = 0.01;
    const MIN_H = 0.01;
    if (wPct < MIN_W || hPct < MIN_H) {
      return NextResponse.json(
        { 
          error: "Crop is too small. Make the rectangle bigger.",
          reason: "CROP_TOO_SMALL"
        },
        { status: 400 }
      );
    }

    // Note: DPI support for pro templates would require updating WorkOrderTemplate type
    // For now, DPI is handled in the onboarding templates endpoint only

    // Save template to Sheets
    await upsertTemplateToSheet({
      spreadsheetId,
      accessToken: user.googleAccessToken,
      template,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Templates Save] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save template" },
      { status: 500 }
    );
  }
}

