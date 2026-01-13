// app/api/db/export-jobs/process/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { processPendingExportJobs } from "@/lib/exports/processExportJobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : 10; // Default to 10 jobs per request

    // Process pending export jobs
    const result = await processPendingExportJobs(workspaceId, limit);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[DB Export Jobs Process API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
