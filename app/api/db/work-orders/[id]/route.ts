// app/api/db/work-orders/[id]/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getWorkOrderDetail } from "@/lib/db/services/workOrders";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found. Please configure your Google Sheets spreadsheet." },
        { status: 400 }
      );
    }

    const workOrderId = params.id;
    const workOrder = await getWorkOrderDetail(workspaceId, workOrderId);

    if (!workOrder) {
      return NextResponse.json(
        { error: "Work order not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(workOrder);
  } catch (error) {
    console.error("[DB Work Order Detail API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
