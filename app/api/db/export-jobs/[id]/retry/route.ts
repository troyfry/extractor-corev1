// app/api/db/export-jobs/[id]/retry/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { retryExportJob } from "@/lib/db/services/exportJobs";

export const runtime = "nodejs";

export async function POST(
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

    const exportJobId = params.id;

    try {
      await retryExportJob(workspaceId, exportJobId);
      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === "Export job not found or access denied") {
        return NextResponse.json(
          { error: error.message },
          { status: 404 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("[DB Export Job Retry API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
