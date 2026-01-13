// app/api/db/preview/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { db } from "@/lib/db/drizzle";
import {
  work_orders,
  signed_documents,
  export_jobs,
  workspaces,
  workspace_members,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";

export const runtime = "nodejs";

/**
 * GET /api/db/preview
 * Preview last 20 work orders + export status.
 * Admin/debug endpoint.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    // Get workspace ID from DB (by spreadsheet ID)
    const workspace = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.spreadsheet_id, spreadsheetId))
      .limit(1);

    if (workspace.length === 0) {
      return NextResponse.json({
        error: "Workspace not found in DB",
        workOrders: [],
        exportStats: null,
      });
    }

    const dbWorkspaceId = workspace[0].id;

    // Get last 20 work orders
    const recentWorkOrders = await db
      .select()
      .from(work_orders)
      .where(eq(work_orders.workspace_id, dbWorkspaceId))
      .orderBy(desc(work_orders.created_at))
      .limit(20);

    // Get export job stats (count by status)
    const allExportJobs = await db
      .select()
      .from(export_jobs)
      .where(eq(export_jobs.workspace_id, dbWorkspaceId));

    const exportStats = allExportJobs.reduce(
      (acc, job) => {
        const status = job.status || "UNKNOWN";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Get export jobs for these work orders
    const workOrderIds = recentWorkOrders.map((wo) => wo.id);
    const exportJobsForWorkOrders = workOrderIds.length > 0
      ? allExportJobs.filter(
          (job) => job.job_type === "WORK_ORDER" && workOrderIds.includes(job.entity_id)
        )
      : [];

    // Map export status to work orders
    const workOrdersWithExport = recentWorkOrders.map((wo) => {
      const exportJob = exportJobsForWorkOrders.find(
        (job) => job.entity_id === wo.id
      );
      return {
        ...wo,
        exportStatus: exportJob?.status || "NO_JOB",
        exportError: exportJob?.error_message || null,
        exportAttempts: exportJob?.attempts || 0,
      };
    });

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json({
      workspaceId: dbWorkspaceId,
      spreadsheetId: spreadsheetId,
      workOrders: workOrdersWithExport,
      exportStats,
    });

    if (workspaceResult.source === "users_sheet") {
      const { rehydrateWorkspaceCookies } = await import(
        "@/lib/workspace/workspaceCookies"
      );
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }

    return response;
  } catch (error) {
    console.error("[DB Preview] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch preview";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
