// lib/db/services/exportJobs.ts
import { db } from "../drizzle";
import { export_jobs, work_orders } from "../schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

export type ExportJobListItem = InferSelectModel<typeof export_jobs> & {
  work_order_id: string | null;
  work_order_number: string | null;
};

export interface ListExportJobsFilters {
  status?: string;
}

export interface PaginationParams {
  limit?: number;
  cursor?: string; // export_job.id for cursor-based pagination
}

export interface ListExportJobsResult {
  items: ExportJobListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * List export jobs with filters and pagination.
 * Enforces workspace_id scoping.
 */
export async function listExportJobs(
  workspaceId: string,
  filters: ListExportJobsFilters = {},
  pagination: PaginationParams = {}
): Promise<ListExportJobsResult> {
  const limit = Math.min(pagination.limit || 20, 100); // Max 100 per page
  const cursor = pagination.cursor;

  // Build WHERE conditions
  const conditions = [eq(export_jobs.workspace_id, workspaceId)];

  if (filters.status) {
    conditions.push(eq(export_jobs.status, filters.status));
  }

  // Cursor-based pagination
  if (cursor) {
    conditions.push(sql`${export_jobs.id} < ${cursor}`);
  }

  // Main query with left join to work_orders (for WORK_ORDER job types)
  const query = db
    .select({
      // Export job fields
      id: export_jobs.id,
      workspace_id: export_jobs.workspace_id,
      job_type: export_jobs.job_type,
      entity_id: export_jobs.entity_id,
      status: export_jobs.status,
      error_code: export_jobs.error_code,
      error_message: export_jobs.error_message,
      attempts: export_jobs.attempts,
      next_retry_at: export_jobs.next_retry_at,
      completed_at: export_jobs.completed_at,
      created_at: export_jobs.created_at,
      updated_at: export_jobs.updated_at,
      // Work order info (if job_type is WORK_ORDER)
      work_order_id: sql<string | null>`CASE 
        WHEN ${export_jobs.job_type} = 'WORK_ORDER' THEN ${export_jobs.entity_id}
        ELSE NULL
      END`,
      work_order_number: sql<string | null>`CASE 
        WHEN ${export_jobs.job_type} = 'WORK_ORDER' THEN ${work_orders.work_order_number}
        ELSE NULL
      END`,
    })
    .from(export_jobs)
    .leftJoin(
      work_orders,
      and(
        eq(export_jobs.workspace_id, work_orders.workspace_id),
        eq(export_jobs.entity_id, work_orders.id),
        eq(export_jobs.job_type, "WORK_ORDER")
      )
    )
    .where(and(...conditions))
    .orderBy(desc(export_jobs.created_at))
    .limit(limit + 1); // Fetch one extra to check if there's more

  const results = await query;

  // Check if there are more results
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  // Get next cursor (last item's id)
  const nextCursor = items.length > 0 ? items[items.length - 1].id : null;

  return {
    items: items.map((row) => ({
      ...row,
      work_order_id: row.work_order_id || null,
      work_order_number: row.work_order_number || null,
    })),
    nextCursor,
    hasMore,
  };
}

/**
 * Retry an export job.
 * Sets status to PENDING, increments manual_retry counter, clears error_code, sets next_retry_at = now.
 * Enforces workspace_id scoping.
 */
export async function retryExportJob(
  workspaceId: string,
  exportJobId: string
): Promise<void> {
  // Verify job belongs to workspace
  const [job] = await db
    .select()
    .from(export_jobs)
    .where(and(
      eq(export_jobs.id, exportJobId),
      eq(export_jobs.workspace_id, workspaceId)
    ))
    .limit(1);

  if (!job) {
    throw new Error("Export job not found or access denied");
  }

  // Update job to retry
  await db
    .update(export_jobs)
    .set({
      status: "PENDING",
      error_code: null,
      error_message: null,
      next_retry_at: new Date(),
      attempts: sql`${export_jobs.attempts} + 1`,
      updated_at: new Date(),
    })
    .where(eq(export_jobs.id, exportJobId));
}
