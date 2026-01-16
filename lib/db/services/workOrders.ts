// lib/db/services/workOrders.ts
import { db } from "../drizzle";
import {
  work_orders,
  work_order_sources,
  signed_match,
  signed_documents,
  export_jobs,
  extraction_runs,
  fm_profiles,
} from "../schema";
import { eq, and, or, desc, sql, ilike, isNull, isNotNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

export type WorkOrderListItem = InferSelectModel<typeof work_orders> & {
  fm_profile_display_name: string | null;
  signed_at: Date | null;
  signed_pdf_url: string | null;
  export_status: "EXPORTED" | "PENDING" | "FAILED" | "FAILED_QUOTA" | null;
  export_error_code: string | null;
};

export type WorkOrderDetail = InferSelectModel<typeof work_orders> & {
  fm_profile_display_name: string | null;
  sources: Array<InferSelectModel<typeof work_order_sources>>;
  signed_document: (InferSelectModel<typeof signed_documents> & {
    signed_match: InferSelectModel<typeof signed_match> | null;
  }) | null;
  latest_extraction_run: InferSelectModel<typeof extraction_runs> | null;
  export_jobs: Array<InferSelectModel<typeof export_jobs>>;
};

export interface ListWorkOrdersFilters {
  status?: string;
  search?: string; // Search in work_order_number, customer_name, service_address
  fmKey?: string;
}

export interface PaginationParams {
  limit?: number;
  cursor?: string; // work_order.id for cursor-based pagination
}

export interface ListWorkOrdersResult {
  items: WorkOrderListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * List work orders with filters and pagination.
 * Enforces workspace_id scoping.
 */
export async function listWorkOrders(
  workspaceId: string,
  filters: ListWorkOrdersFilters = {},
  pagination: PaginationParams = {}
): Promise<ListWorkOrdersResult> {
  const limit = Math.min(pagination.limit || 20, 100); // Max 100 per page
  const cursor = pagination.cursor;

  // Build WHERE conditions
  const conditions = [eq(work_orders.workspace_id, workspaceId)];

  if (filters.status) {
    conditions.push(eq(work_orders.status, filters.status));
  }

  if (filters.fmKey) {
    conditions.push(eq(work_orders.fm_key, filters.fmKey));
  }

  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(work_orders.work_order_number, searchPattern),
        ilike(work_orders.customer_name, searchPattern),
        ilike(work_orders.service_address, searchPattern)
      )!
    );
  }

  // Cursor-based pagination
  if (cursor) {
    conditions.push(sql`${work_orders.id} < ${cursor}`);
  }

  // Main query with joins
  const query = db
    .select({
      // Work order fields
      id: work_orders.id,
      workspace_id: work_orders.workspace_id,
      job_id: work_orders.job_id,
      work_order_number: work_orders.work_order_number,
      fm_key: work_orders.fm_key,
      customer_name: work_orders.customer_name,
      service_address: work_orders.service_address,
      job_type: work_orders.job_type,
      job_description: work_orders.job_description,
      vendor_name: work_orders.vendor_name,
      scheduled_date: work_orders.scheduled_date,
      priority: work_orders.priority,
      amount: work_orders.amount,
      currency: work_orders.currency,
      nte_amount: work_orders.nte_amount,
      status: work_orders.status,
      work_order_pdf_link: work_orders.work_order_pdf_link,
      signed_pdf_url: work_orders.signed_pdf_url,
      signed_preview_image_url: work_orders.signed_preview_image_url,
      signed_at: work_orders.signed_at,
      notes: work_orders.notes,
      calendar_event_link: work_orders.calendar_event_link,
      created_at: work_orders.created_at,
      updated_at: work_orders.updated_at,
      // FM profile display name
      fm_profile_display_name: fm_profiles.display_name,
    })
    .from(work_orders)
    .leftJoin(fm_profiles, and(
      eq(fm_profiles.workspace_id, workspaceId),
      eq(fm_profiles.fm_key, work_orders.fm_key)
    ))
    .where(and(...conditions))
    .orderBy(desc(work_orders.created_at))
    .limit(limit + 1); // Fetch one extra to check if there's more

  const results = await query;

  // Get export status for each work order (separate query for better performance)
  // Use DISTINCT ON to get the latest export job per work order
  const workOrderIds = results.map((r) => r.id);
  const exportStatusMap = new Map<string, { status: string; error_code: string | null }>();
  
  if (workOrderIds.length > 0) {
    // For each work order, get the latest export job
    for (const woId of workOrderIds) {
      const [latestJob] = await db
        .select({
          status: export_jobs.status,
          error_code: export_jobs.error_code,
        })
        .from(export_jobs)
        .where(and(
          eq(export_jobs.workspace_id, workspaceId),
          eq(export_jobs.job_type, "WORK_ORDER"),
          eq(export_jobs.entity_id, woId)
        ))
        .orderBy(desc(export_jobs.created_at))
        .limit(1);

      if (latestJob) {
        exportStatusMap.set(woId, {
          status: latestJob.status,
          error_code: latestJob.error_code || null,
        });
      }
    }
  }


  // Check if there are more results
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  // Get next cursor (last item's id)
  const nextCursor = items.length > 0 ? items[items.length - 1].id : null;

  return {
    items: items.map((row) => {
      const exportStatus = exportStatusMap.get(row.id);
      return {
        ...row,
        fm_profile_display_name: row.fm_profile_display_name || null,
        signed_at: row.signed_at || null,
        signed_pdf_url: row.signed_pdf_url || null,
        export_status: exportStatus?.status as "EXPORTED" | "PENDING" | "FAILED" | "FAILED_QUOTA" | null || null,
        export_error_code: exportStatus?.error_code || null,
      };
    }),
    nextCursor,
    hasMore,
  };
}

/**
 * Get a single work order with all related data.
 * Enforces workspace_id scoping.
 */
export async function getWorkOrderDetail(
  workspaceId: string,
  workOrderId: string
): Promise<WorkOrderDetail | null> {
  // Get work order
  const [workOrder] = await db
    .select()
    .from(work_orders)
    .where(and(
      eq(work_orders.id, workOrderId),
      eq(work_orders.workspace_id, workspaceId)
    ))
    .limit(1);

  if (!workOrder) {
    return null;
  }

  // Get FM profile display name
  const [fmProfile] = await db
    .select({ display_name: fm_profiles.display_name })
    .from(fm_profiles)
    .where(and(
      eq(fm_profiles.workspace_id, workspaceId),
      eq(fm_profiles.fm_key, workOrder.fm_key || "")
    ))
    .limit(1);

  // Get sources
  const sources = await db
    .select()
    .from(work_order_sources)
    .where(eq(work_order_sources.work_order_id, workOrderId))
    .orderBy(desc(work_order_sources.created_at));

  // Get signed document if exists
  const [signedMatch] = await db
    .select()
    .from(signed_match)
    .where(eq(signed_match.work_order_id, workOrderId))
    .limit(1);

  let signedDocument = null;
  if (signedMatch) {
    const [doc] = await db
      .select()
      .from(signed_documents)
      .where(eq(signed_documents.id, signedMatch.signed_document_id))
      .limit(1);
    
    if (doc) {
      signedDocument = {
        ...doc,
        signed_match: signedMatch,
      };
    }
  }

  // Get latest extraction run
  const [latestExtractionRun] = await db
    .select()
    .from(extraction_runs)
    .where(eq(extraction_runs.work_order_id, workOrderId))
    .orderBy(desc(extraction_runs.created_at))
    .limit(1);

  // Get export job history (last 10)
  // entity_id stores work_order_id for WORK_ORDER and SIGNED_MATCH job types
  const exportJobs = await db
    .select()
    .from(export_jobs)
    .where(and(
      eq(export_jobs.entity_id, workOrderId),
      eq(export_jobs.workspace_id, workspaceId),
      or(
        eq(export_jobs.job_type, "WORK_ORDER"),
        eq(export_jobs.job_type, "SIGNED_MATCH")
      )
    ))
    .orderBy(desc(export_jobs.created_at))
    .limit(10);

  return {
    ...workOrder,
    fm_profile_display_name: fmProfile?.display_name || null,
    sources,
    signed_document: signedDocument,
    latest_extraction_run: latestExtractionRun || null,
    export_jobs: exportJobs,
  };
}

/**
 * Check if a work order is already signed.
 * Returns true if work order exists and has status SIGNED or has a signed_match.
 * 
 * @param workspaceId - Workspace ID
 * @param workOrderNumber - Work order number to check
 * @returns True if work order is signed, false otherwise
 */
export async function isWorkOrderSigned(
  workspaceId: string,
  workOrderNumber: string
): Promise<boolean> {
  if (!workOrderNumber || !workOrderNumber.trim()) {
    return false;
  }

  // Find work order by workspace + work_order_number
  const [workOrder] = await db
    .select({
      id: work_orders.id,
      status: work_orders.status,
    })
    .from(work_orders)
    .where(
      and(
        eq(work_orders.workspace_id, workspaceId),
        eq(work_orders.work_order_number, workOrderNumber.trim())
      )
    )
    .limit(1);

  if (!workOrder) {
    return false;
  }

  // Check if status is SIGNED
  if (workOrder.status?.toUpperCase() === "SIGNED") {
    return true;
  }

  // Check if work order has a signed_match (more reliable check)
  const [signedMatch] = await db
    .select()
    .from(signed_match)
    .where(eq(signed_match.work_order_id, workOrder.id))
    .limit(1);

  return signedMatch !== undefined;
}
