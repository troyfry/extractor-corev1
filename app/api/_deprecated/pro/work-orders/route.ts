import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/_deprecated/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { createSheetsClient, formatSheetRange, WORK_ORDER_REQUIRED_COLUMNS } from "@/lib/google/sheets";
import { getErrorMessage } from "@/lib/utils/error";
import { getColumnRange } from "@/lib/google/sheetsCache";

export const runtime = "nodejs";

const WORK_ORDERS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

export type WorkOrderRow = {
  jobId: string;
  fmKey: string | null;
  wo_number: string;
  status: string | null;
  created_at: string | null;
  scheduled_date: string | null;
  timestamp_extracted: string | null;
  signed_at: string | null;
  work_order_pdf_link: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
};

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
      return NextResponse.json(
        { error: "Google authentication required. Please sign in with Google." },
        { status: 401 }
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

    // Read Work_Orders sheet
    const sheets = createSheetsClient(user.googleAccessToken);

    // Get all data from Work_Orders sheet
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(WORK_ORDERS_SHEET_NAME, getColumnRange(WORK_ORDER_REQUIRED_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    // First row is headers
    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => h.toLowerCase().trim());

    // Helper to get column index by name (case-insensitive)
    const getIndex = (colName: string): number => {
      return headersLower.indexOf(colName.toLowerCase());
    };

    // Map data rows to WorkOrderRow
    const workOrderRows: WorkOrderRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const jobIdCol = getIndex("jobid");
      const woNumberCol = getIndex("wo_number");
      
      // Skip rows without jobId or wo_number
      if (jobIdCol === -1 || woNumberCol === -1) continue;
      if (!row[jobIdCol] || !row[woNumberCol]) continue;

      const rowData: WorkOrderRow = {
        jobId: String(row[jobIdCol] || ""),
        fmKey: (() => {
          const idx = getIndex("fmkey");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        wo_number: String(row[woNumberCol] || ""),
        status: (() => {
          const idx = getIndex("status");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        created_at: (() => {
          const idx = getIndex("created_at");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        scheduled_date: (() => {
          const idx = getIndex("scheduled_date");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        timestamp_extracted: (() => {
          const idx = getIndex("timestamp_extracted");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        signed_at: (() => {
          const idx = getIndex("signed_at");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        work_order_pdf_link: (() => {
          const idx = getIndex("work_order_pdf_link");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        signed_pdf_url: (() => {
          const idx = getIndex("signed_pdf_url");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
        signed_preview_image_url: (() => {
          const idx = getIndex("signed_preview_image_url");
          return idx !== -1 && row[idx] ? String(row[idx]) : null;
        })(),
      };

      workOrderRows.push(rowData);
    }

    console.log(`[Work Orders GET] Returning ${workOrderRows.length} work order(s)`);
    
    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json({ rows: workOrderRows });
    if (workspaceResult && workspaceResult.source === "users_sheet") {
      const { rehydrateWorkspaceCookies } = await import("@/lib/workspace/workspaceCookies");
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    return response;
  } catch (error: unknown) {
    console.error("[Work Orders GET] Error:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Failed to fetch work orders" },
      { status: 500 }
    );
  }
}

