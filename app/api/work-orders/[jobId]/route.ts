import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";

export const runtime = "nodejs";

/**
 * GET /api/work-orders/:jobId
 * Get a single work order by jobId.
 * 
 * Uses read adapter to route to DB or legacy based on feature flag + workspace setting.
 * Falls back to legacy if DB read fails.
 */
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

    // Get Google access token (required for legacy fallback)
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

    // Use read adapter (routes to DB or legacy based on feature flag + workspace setting)
    const { getWorkOrderDetailUnified } = await import("@/lib/readAdapter/workOrderDetail");
    const result = await getWorkOrderDetailUnified({ id: jobId });

    if (!result.workOrder) {
      return NextResponse.json(
        { error: "Work order not found" },
        { status: 404 }
      );
    }

    // Map unified format back to legacy WorkOrder type for backward compatibility
    const workOrder: import("@/lib/workOrders/types").WorkOrder = {
      id: result.workOrder.id,
      jobId: result.workOrder.jobId,
      userId: null,
      timestampExtracted: result.workOrder.createdAt,
      workOrderNumber: result.workOrder.workOrderNumber || "",
      fmKey: result.workOrder.fmKey,
      status: result.workOrder.status,
      customerName: result.workOrder.customerName,
      vendorName: result.workOrder.vendorName,
      serviceAddress: result.workOrder.serviceAddress,
      jobType: result.workOrder.jobType,
      jobDescription: result.workOrder.jobDescription,
      scheduledDate: result.workOrder.scheduledDate,
      amount: result.workOrder.amount,
      currency: result.workOrder.currency,
      notes: result.workOrder.notes,
      priority: result.workOrder.priority,
      calendarEventLink: null, // Not in unified format yet
      workOrderPdfLink: result.workOrder.workOrderPdfLink,
      signedPdfUrl: result.workOrder.signedPdfUrl,
      signedPreviewImageUrl: result.workOrder.signedPreviewImageUrl,
      createdAt: result.workOrder.createdAt,
    };

    // Rehydrate cookies if needed (for legacy compatibility)
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const workspaceResult = await getWorkspace();
    
    const response = NextResponse.json({ 
      workOrder,
      dataSource: result.dataSource, // Include data source in response
      fallbackUsed: result.fallbackUsed, // Include fallback indicator
    });
    
    if (workspaceResult && workspaceResult.source === "users_sheet") {
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
