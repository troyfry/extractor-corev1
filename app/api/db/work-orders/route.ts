// app/api/db/work-orders/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { listWorkOrders } from "@/lib/db/services/workOrders";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("q") || undefined;
    const fmKey = searchParams.get("fmKey") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : undefined;
    const cursor = searchParams.get("cursor") || undefined;

    const result = await listWorkOrders(
      workspaceId,
      {
        status,
        search,
        fmKey,
      },
      {
        limit,
        cursor,
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[DB Work Orders API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
