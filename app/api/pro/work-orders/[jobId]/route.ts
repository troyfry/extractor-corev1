import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
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

    // Get spreadsheet ID - check cookie first (session-based, no DB)
    const { cookies } = await import("next/headers");
    const cookieSpreadsheetId = (await cookies()).get("googleSheetsSpreadsheetId")?.value || null;

    // Use cookie if available, otherwise check session/JWT token
    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      // Then check session/JWT token
      const { auth } = await import("@/auth");
      const session = await auth();
      const sessionSpreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId : null;
      spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
    }

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: "Google Sheets spreadsheet ID not configured. Please set it in Settings." },
        { status: 400 }
      );
    }

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

    return NextResponse.json({ workOrder });
  } catch (error: unknown) {
    console.error("[Work Order GET] Error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Failed to fetch work order" },
      { status: 500 }
    );
  }
}

