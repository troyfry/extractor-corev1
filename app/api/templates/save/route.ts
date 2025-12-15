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

    // Validate zone values
    const zone = template.woNumberZone;
    if (
      zone.xPct < 0 || zone.xPct > 1 ||
      zone.yPct < 0 || zone.yPct > 1 ||
      zone.wPct < 0 || zone.wPct > 1 ||
      zone.hPct < 0 || zone.hPct > 1 ||
      zone.page < 1
    ) {
      return NextResponse.json(
        { error: "Invalid zone values. Percentages must be between 0 and 1." },
        { status: 400 }
      );
    }

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

