import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/_deprecated/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { findWorkOrderRecordByJobId } from "@/lib/google/sheets";
import { getErrorMessage } from "@/lib/utils/error";

export const runtime = "nodejs";

const WORK_ORDERS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
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

    // Get jobId from params
    const { jobId } = await params;
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required" },
        { status: 400 }
      );
    }

    // Get workspace (uses cookie module internally)
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const workspaceResult = await getWorkspace();
    
    if (!workspaceResult) {
      return NextResponse.json(
        { error: "Workspace not found. Please complete onboarding." },
        { status: 400 }
      );
    }

    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    // Find work order by jobId
    const workOrder = await findWorkOrderRecordByJobId(
      user.googleAccessToken,
      spreadsheetId,
      WORK_ORDERS_SHEET_NAME,
      jobId
    );

    if (!workOrder) {
      return NextResponse.json(
        { error: "Work order not found" },
        { status: 404 }
      );
    }

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json({ workOrder });
    if (workspaceResult && workspaceResult.source === "users_sheet") {
      const { rehydrateWorkspaceCookies } = await import("@/lib/workspace/workspaceCookies");
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    return response;
  } catch (error: unknown) {
    console.error("[Work Order GET] Error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Failed to fetch work order" },
      { status: 500 }
    );
  }
}

