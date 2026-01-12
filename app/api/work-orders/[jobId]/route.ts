import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { findWorkOrderRecordByJobId } from "@/lib/google/sheets";

export const runtime = "nodejs";

const WORK_ORDERS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    // Get authenticated user
    const user = await getCurrentUser();
    if (!user) {
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

    // Get workspace
    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    // Find work order by jobId
    const workOrderRecord = await findWorkOrderRecordByJobId(
      user.googleAccessToken,
      spreadsheetId,
      WORK_ORDERS_SHEET_NAME,
      jobId
    );

    if (!workOrderRecord) {
      return NextResponse.json(
        { error: "Work order not found" },
        { status: 404 }
      );
    }

    // Map WorkOrderRecord to WorkOrder type
    const workOrder = {
      id: workOrderRecord.jobId,
      jobId: workOrderRecord.jobId,
      userId: null, // Not stored in WorkOrderRecord
      timestampExtracted: workOrderRecord.timestamp_extracted || workOrderRecord.created_at,
      workOrderNumber: workOrderRecord.wo_number,
      fmKey: workOrderRecord.fmKey,
      status: workOrderRecord.status,
      customerName: workOrderRecord.customer_name,
      vendorName: workOrderRecord.vendor_name,
      serviceAddress: workOrderRecord.service_address,
      jobType: workOrderRecord.job_type,
      jobDescription: workOrderRecord.job_description,
      scheduledDate: workOrderRecord.scheduled_date,
      amount: workOrderRecord.amount,
      currency: workOrderRecord.currency,
      notes: workOrderRecord.notes,
      priority: workOrderRecord.priority,
      calendarEventLink: workOrderRecord.calendar_event_link,
      workOrderPdfLink: workOrderRecord.work_order_pdf_link,
      signedPdfUrl: workOrderRecord.signed_pdf_url,
      signedPreviewImageUrl: workOrderRecord.signed_preview_image_url,
      createdAt: workOrderRecord.created_at,
      signedAt: workOrderRecord.signed_at,
      lastUpdatedAt: workOrderRecord.last_updated_at,
    };

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json({ workOrder });
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    return response;
  } catch (error) {
    console.error("[Work Order GET] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch work order";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
