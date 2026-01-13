// lib/exports/processExportJobs.ts
import { db } from "@/lib/db/drizzle";
import { export_jobs, work_orders, workspaces } from "@/lib/db/schema";
import { eq, and, or, lte, isNull } from "drizzle-orm";
import { updateWorkOrderRecordPartial } from "@/lib/google/sheets";
import { getCurrentUser } from "@/lib/auth/currentUser";

const MAX_JOBS_PER_BATCH = 10;
const MAX_ATTEMPTS = 5;
// Capped exponential backoff: 5m, 15m, 1h, 6h, 24h (in milliseconds)
const BACKOFF_DELAYS_MS = [
  5 * 60 * 1000,      // 5 minutes
  15 * 60 * 1000,     // 15 minutes
  60 * 60 * 1000,     // 1 hour
  6 * 60 * 60 * 1000, // 6 hours
  24 * 60 * 60 * 1000, // 24 hours (max)
];

/**
 * Process pending export jobs for a workspace.
 * Uses locking to prevent double-processing.
 * Stops early on quota errors to avoid hammering Sheets API.
 * Returns counts of jobs processed.
 */
export async function processPendingExportJobs(
  workspaceId: string,
  limit: number = MAX_JOBS_PER_BATCH
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  failedQuota: number;
  remainingPending: number;
}> {
  const now = new Date();

  // Get pending jobs that are ready to retry (with workspace scoping)
  const allPendingJobs = await db
    .select()
    .from(export_jobs)
    .where(
      and(
        eq(export_jobs.workspace_id, workspaceId),
        eq(export_jobs.status, "PENDING"),
        or(
          isNull(export_jobs.next_retry_at),
          lte(export_jobs.next_retry_at, now)
        )
      )
    )
    .limit(limit * 2); // Get more to filter

  // Filter to jobs ready to process
  const readyJobs = allPendingJobs
    .filter((job) => !job.next_retry_at || job.next_retry_at <= now)
    .slice(0, limit);

  if (readyJobs.length === 0) {
    // Count remaining pending jobs
    const remainingPending = await db
      .select()
      .from(export_jobs)
      .where(
        and(
          eq(export_jobs.workspace_id, workspaceId),
          eq(export_jobs.status, "PENDING")
        )
      );
    
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      failedQuota: 0,
      remainingPending: remainingPending.length,
    };
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let failedQuota = 0;
  let quotaErrorHit = false;

  for (const job of readyJobs) {
    try {
      // Lock job by updating status to PROCESSING with lock owner
      // This prevents double-processing if multiple requests run concurrently
      const lockResult = await db
        .update(export_jobs)
        .set({
          status: "PROCESSING",
          updated_at: now,
        })
        .where(
          and(
            eq(export_jobs.id, job.id),
            eq(export_jobs.status, "PENDING") // Only lock if still PENDING
          )
        );

      // If no rows updated, job was already locked/processed by another request
      // Skip it (idempotent)
      if (!lockResult || (lockResult as any).rowCount === 0) {
        continue;
      }

      // Get workspace for this job
      const { workspaces } = await import("@/lib/db/schema");
      const workspace = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, job.workspace_id))
        .limit(1);

      if (workspace.length === 0) {
        throw new Error(`Workspace not found: ${job.workspace_id}`);
      }

      const spreadsheetId = workspace[0].spreadsheet_id;

      // Get user for access token
      const user = await getCurrentUser();
      if (!user?.googleAccessToken) {
        throw new Error("User not authenticated");
      }

      // Process based on job type
      if (job.job_type === "WORK_ORDER") {
        await processWorkOrderExport(
          job.entity_id,
          user.googleAccessToken,
          spreadsheetId
        );
      } else if (job.job_type === "SIGNED_DOCUMENT") {
        // Signed documents are exported via their matched work orders
        // Skip direct export
      } else if (job.job_type === "SIGNED_MATCH") {
        await processSignedMatchExport(
          job.entity_id,
          user.googleAccessToken,
          spreadsheetId
        );
      }

      // Mark as done
      await db
        .update(export_jobs)
        .set({
          status: "DONE",
          completed_at: now,
          updated_at: now,
        })
        .where(eq(export_jobs.id, job.id));

      processed++;
      succeeded++;
    } catch (error) {
      processed++;
      failed++;

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isQuotaError =
        errorMessage.includes("quota") ||
        errorMessage.includes("429") ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("Quota exceeded");

      if (isQuotaError) {
        failedQuota++;
        quotaErrorHit = true;
        // Stop processing on quota error (don't spam Sheets API)
        break;
      }

      // Calculate next retry (capped exponential backoff)
      const attempts = (job.attempts || 0) + 1;
      const backoffIndex = Math.min(attempts - 1, BACKOFF_DELAYS_MS.length - 1);
      const retryDelay = BACKOFF_DELAYS_MS[backoffIndex];
      const nextRetryAt = new Date(now.getTime() + retryDelay);

      if (attempts >= MAX_ATTEMPTS) {
        // Mark as failed after max attempts
        await db
          .update(export_jobs)
          .set({
            status: "FAILED",
            error_code: "MAX_ATTEMPTS_EXCEEDED",
            error_message: errorMessage,
            attempts,
            updated_at: now,
          })
          .where(eq(export_jobs.id, job.id));
      } else {
        // Schedule retry with exponential backoff
        await db
          .update(export_jobs)
          .set({
            status: "PENDING",
            error_code: isQuotaError ? "QUOTA_EXCEEDED" : "EXPORT_ERROR",
            error_message: errorMessage,
            attempts,
            next_retry_at: nextRetryAt,
            updated_at: now,
          })
          .where(eq(export_jobs.id, job.id));
      }
    }
  }

  // Count remaining pending jobs
  const remainingPending = await db
    .select()
    .from(export_jobs)
    .where(
      and(
        eq(export_jobs.workspace_id, workspaceId),
        eq(export_jobs.status, "PENDING")
      )
    );

  return {
    processed,
    succeeded,
    failed,
    failedQuota,
    remainingPending: remainingPending.length,
  };
}

/**
 * Legacy function for backward compatibility.
 * Processes jobs across all workspaces (use with caution).
 */
export async function processExportJobs(
  maxJobs: number = MAX_JOBS_PER_BATCH
): Promise<{ processed: number; failed: number; quotaError: boolean }> {
  // This is a simplified version that doesn't scope by workspace
  // Prefer processPendingExportJobs for workspace-scoped processing
  const result = await processPendingExportJobs("", maxJobs);
  return {
    processed: result.processed,
    failed: result.failed,
    quotaError: result.failedQuota > 0,
  };
}

/**
 * Export work order to Sheets.
 */
async function processWorkOrderExport(
  workOrderId: string,
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const workOrder = await db
    .select()
    .from(work_orders)
    .where(eq(work_orders.id, workOrderId))
    .limit(1);

  if (workOrder.length === 0) {
    throw new Error(`Work order not found: ${workOrderId}`);
  }

  const wo = workOrder[0];
  const WORK_ORDERS_SHEET_NAME =
    process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

  // Map DB record to Sheets format
  const workOrderRecord: Record<string, string | null> = {
    jobId: wo.job_id,
    fmKey: wo.fm_key || null,
    wo_number: wo.work_order_number || "MISSING",
    status: wo.status || "OPEN",
    scheduled_date: wo.scheduled_date || null,
    created_at: wo.created_at?.toISOString() || new Date().toISOString(),
    timestamp_extracted: wo.created_at?.toISOString() || new Date().toISOString(),
    customer_name: wo.customer_name || null,
    vendor_name: wo.vendor_name || null,
    service_address: wo.service_address || null,
    job_type: wo.job_type || null,
    job_description: wo.job_description || null,
    amount: wo.amount || null,
    currency: wo.currency || null,
    notes: wo.notes || null,
    priority: wo.priority || null,
    calendar_event_link: wo.calendar_event_link || null,
    work_order_pdf_link: wo.work_order_pdf_link || null,
    signed_pdf_url: wo.signed_pdf_url || null,
    signed_preview_image_url: wo.signed_preview_image_url || null,
    signed_at: wo.signed_at?.toISOString() || null,
    source: "DB_EXPORT",
    last_updated_at: wo.updated_at?.toISOString() || new Date().toISOString(),
    file_hash: null,
  };

  // Try to update existing record
  // This is best-effort - export jobs can be retried if it fails
  await updateWorkOrderRecordPartial(
    accessToken,
    spreadsheetId,
    WORK_ORDERS_SHEET_NAME,
    wo.job_id,
    wo.work_order_number || "MISSING",
    workOrderRecord as any // Type assertion needed due to Record type
  );
}

/**
 * Export signed match to Sheets (update work order with signed info).
 */
async function processSignedMatchExport(
  workOrderId: string,
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const workOrder = await db
    .select()
    .from(work_orders)
    .where(eq(work_orders.id, workOrderId))
    .limit(1);

  if (workOrder.length === 0) {
    throw new Error(`Work order not found: ${workOrderId}`);
  }

  const wo = workOrder[0];
  const WORK_ORDERS_SHEET_NAME =
    process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

  // Update only signed fields
  await updateWorkOrderRecordPartial(
    accessToken,
    spreadsheetId,
    WORK_ORDERS_SHEET_NAME,
    wo.job_id,
    wo.work_order_number || "MISSING",
    {
      status: wo.status || "SIGNED",
      signed_pdf_url: wo.signed_pdf_url || null,
      signed_preview_image_url: wo.signed_preview_image_url || null,
      signed_at: wo.signed_at?.toISOString() || null,
      last_updated_at: wo.updated_at?.toISOString() || new Date().toISOString(),
    }
  );
}
