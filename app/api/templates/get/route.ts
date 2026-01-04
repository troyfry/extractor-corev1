import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { getTemplateFromSheet } from "@/lib/templates/sheetsTemplates";

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
      // Return 200 with null template instead of error - user just needs to configure
      return NextResponse.json({
        template: null,
        error: "Google authentication required",
      });
    }

    // Get workspace (centralized resolution)
    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    // Get issuerKey from query params
    const { searchParams } = new URL(request.url);
    const issuerKey = searchParams.get("issuerKey");

    if (!issuerKey) {
      return NextResponse.json(
        { error: "issuerKey query parameter is required" },
        { status: 400 }
      );
    }

    // Fetch template from Sheets
    const template = await getTemplateFromSheet({
      spreadsheetId,
      accessToken: user.googleAccessToken,
      issuerKey,
    });

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json({
      template: template || null,
    });
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    return response;
  } catch (error) {
    console.error("[Templates Get] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get template" },
      { status: 500 }
    );
  }
}

