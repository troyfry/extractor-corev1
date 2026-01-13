// lib/readAdapter/workOrderDetail.ts
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getPrimaryReadSource } from "@/lib/db/services/workspace";
import { getWorkOrderDetail } from "@/lib/db/services/workOrders";
import type { WorkOrder } from "@/lib/workOrders/types";

export interface UnifiedWorkOrderDetail {
  id: string;
  jobId: string;
  workOrderNumber: string | null;
  customerName: string | null;
  serviceAddress: string | null;
  jobType: string | null;
  jobDescription: string | null;
  vendorName: string | null;
  scheduledDate: string | null;
  priority: string | null;
  amount: string | null;
  currency: string | null;
  nteAmount: string | null;
  status: string;
  notes: string | null;
  workOrderPdfLink: string | null;
  signedPdfUrl: string | null;
  signedPreviewImageUrl: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  fmKey: string | null;
  fmDisplayName: string | null;
  // Sources
  sources: Array<{
    id: string;
    sourceType: string;
    fileHash: string;
    sourceMetadata: any;
    createdAt: string;
  }>;
  // Signed document info
  signedDocument: {
    id: string;
    extractedWorkOrderNumber: string | null;
    extractionMethod: string | null;
    extractionConfidence: string | null;
    extractionRationale: string | null;
    signedPdfUrl: string | null;
    signedPreviewImageUrl: string | null;
    createdAt: string;
  } | null;
  // Extraction provenance
  latestExtractionRun: {
    pipelinePath: string | null;
    woNumberMethod: string | null;
    woNumberConfidence: string | null;
    regionUsed: boolean;
    inputScope: string | null;
    reasons: string[] | null;
    debug: any;
    createdAt: string;
  } | null;
  // Export status
  exportJobs: Array<{
    id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    attempts: number;
    nextRetryAt: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
}

export interface GetWorkOrderDetailUnifiedParams {
  id: string; // Can be jobId (legacy) or DB work_order_id
}

export interface GetWorkOrderDetailUnifiedResult {
  workOrder: UnifiedWorkOrderDetail | null;
  dataSource: "DB" | "LEGACY";
  fallbackUsed: boolean;
}

/**
 * Check if DB primary reads are enabled via feature flag.
 */
function isDbPrimaryReadsEnabled(): boolean {
  return process.env.DB_PRIMARY_READS === "true" || process.env.DB_PRIMARY_READS === "1";
}

/**
 * Unified work order detail adapter.
 * Routes to DB or legacy based on feature flag + workspace setting.
 * Falls back to legacy if DB read fails.
 */
export async function getWorkOrderDetailUnified(
  params: GetWorkOrderDetailUnifiedParams
): Promise<GetWorkOrderDetailUnifiedResult> {
  const { id } = params;

  // Check feature flag
  const dbPrimaryReadsEnabled = isDbPrimaryReadsEnabled();
  
  if (!dbPrimaryReadsEnabled) {
    // Feature flag OFF - use legacy
    return await getWorkOrderDetailLegacy(id);
  }

  // Feature flag ON - check workspace setting
  try {
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      // No workspace - fallback to legacy
      console.log("[Read Adapter Detail] No workspace found, using legacy");
      return await getWorkOrderDetailLegacy(id);
    }

    const primaryReadSource = await getPrimaryReadSource(workspaceId);
    
    if (primaryReadSource !== "DB") {
      // Workspace setting is LEGACY - use legacy
      console.log("[Read Adapter Detail] Workspace primary_read_source is LEGACY, using legacy");
      return await getWorkOrderDetailLegacy(id);
    }

    // Workspace setting is DB - try DB read
    try {
      const dbWorkOrder = await getWorkOrderDetail(workspaceId, id);

      if (!dbWorkOrder) {
        // Not found in DB - try legacy as fallback
        console.log("[Read Adapter Detail] Work order not found in DB, trying legacy");
        return await getWorkOrderDetailLegacy(id);
      }

      // Map DB result to unified format
      const unified: UnifiedWorkOrderDetail = {
        id: dbWorkOrder.id,
        jobId: dbWorkOrder.job_id,
        workOrderNumber: dbWorkOrder.work_order_number,
        customerName: dbWorkOrder.customer_name,
        serviceAddress: dbWorkOrder.service_address,
        jobType: dbWorkOrder.job_type,
        jobDescription: dbWorkOrder.job_description,
        vendorName: dbWorkOrder.vendor_name,
        scheduledDate: dbWorkOrder.scheduled_date,
        priority: dbWorkOrder.priority,
        amount: dbWorkOrder.amount,
        currency: dbWorkOrder.currency,
        nteAmount: dbWorkOrder.nte_amount,
        status: dbWorkOrder.status,
        notes: dbWorkOrder.notes,
        workOrderPdfLink: dbWorkOrder.work_order_pdf_link,
        signedPdfUrl: dbWorkOrder.signed_pdf_url,
        signedPreviewImageUrl: dbWorkOrder.signed_preview_image_url,
        signedAt: dbWorkOrder.signed_at?.toISOString() || null,
        createdAt: dbWorkOrder.created_at.toISOString(),
        updatedAt: dbWorkOrder.updated_at?.toISOString() || null,
        fmKey: dbWorkOrder.fm_key,
        fmDisplayName: dbWorkOrder.fm_profile_display_name,
        sources: dbWorkOrder.sources.map((s) => ({
          id: s.id,
          sourceType: s.source_type,
          fileHash: s.file_hash,
          sourceMetadata: s.source_metadata,
          createdAt: s.created_at.toISOString(),
        })),
        signedDocument: dbWorkOrder.signed_document
          ? {
              id: dbWorkOrder.signed_document.id,
              extractedWorkOrderNumber: dbWorkOrder.signed_document.extracted_work_order_number,
              extractionMethod: dbWorkOrder.signed_document.extraction_method,
              extractionConfidence: dbWorkOrder.signed_document.extraction_confidence,
              extractionRationale: dbWorkOrder.signed_document.extraction_rationale,
              signedPdfUrl: dbWorkOrder.signed_document.signed_pdf_url,
              signedPreviewImageUrl: dbWorkOrder.signed_document.signed_preview_image_url,
              createdAt: dbWorkOrder.signed_document.created_at.toISOString(),
            }
          : null,
        latestExtractionRun: dbWorkOrder.latest_extraction_run
          ? {
              pipelinePath: dbWorkOrder.latest_extraction_run.pipeline_path,
              woNumberMethod: dbWorkOrder.latest_extraction_run.wo_number_method,
              woNumberConfidence: dbWorkOrder.latest_extraction_run.wo_number_confidence,
              regionUsed: dbWorkOrder.latest_extraction_run.region_used,
              inputScope: dbWorkOrder.latest_extraction_run.input_scope,
              reasons: dbWorkOrder.latest_extraction_run.reasons as string[] | null,
              debug: dbWorkOrder.latest_extraction_run.debug,
              createdAt: dbWorkOrder.latest_extraction_run.created_at.toISOString(),
            }
          : null,
        exportJobs: dbWorkOrder.export_jobs.map((j) => ({
          id: j.id,
          status: j.status,
          errorCode: j.error_code,
          errorMessage: j.error_message,
          attempts: j.attempts,
          nextRetryAt: j.next_retry_at?.toISOString() || null,
          createdAt: j.created_at.toISOString(),
          completedAt: j.completed_at?.toISOString() || null,
        })),
      };

      return {
        workOrder: unified,
        dataSource: "DB",
        fallbackUsed: false,
      };
    } catch (dbError) {
      // DB read failed - fallback to legacy
      console.error("[Read Adapter Detail] DB read failed, falling back to legacy:", dbError);
      const legacyResult = await getWorkOrderDetailLegacy(id);
      return {
        ...legacyResult,
        fallbackUsed: true, // Indicate that fallback was used
      };
    }
  } catch (error) {
    // Workspace lookup failed - fallback to legacy
    console.error("[Read Adapter Detail] Workspace lookup failed, falling back to legacy:", error);
    const legacyResult = await getWorkOrderDetailLegacy(id);
    return {
      ...legacyResult,
      fallbackUsed: true,
    };
  }
}

/**
 * Legacy work order detail (from Sheets).
 * This is the existing implementation.
 */
async function getWorkOrderDetailLegacy(
  id: string
): Promise<GetWorkOrderDetailUnifiedResult> {
  // Import legacy service functions
  const { getCurrentUser } = await import("@/auth");
  const { workspaceRequired } = await import("@/lib/workspace/workspaceRequired");
  const { findWorkOrderRecordByJobId } = await import("@/lib/google/sheets");

  const user = await getCurrentUser();
  
  if (!user || !user.googleAccessToken) {
    return {
      workOrder: null,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  }

  try {
    // Get workspace
    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;
    const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

    // Find work order by jobId
    const workOrderRecord = await findWorkOrderRecordByJobId(
      user.googleAccessToken,
      spreadsheetId,
      WORK_ORDERS_SHEET_NAME,
      id
    );

    if (!workOrderRecord) {
      return {
        workOrder: null,
        dataSource: "LEGACY",
        fallbackUsed: false,
      };
    }

    // Map legacy format to unified format
    const unified: UnifiedWorkOrderDetail = {
      id: workOrderRecord.jobId,
      jobId: workOrderRecord.jobId,
      workOrderNumber: workOrderRecord.wo_number,
      customerName: workOrderRecord.customer_name,
      serviceAddress: workOrderRecord.service_address,
      jobType: workOrderRecord.job_type,
      jobDescription: workOrderRecord.job_description,
      vendorName: workOrderRecord.vendor_name,
      scheduledDate: workOrderRecord.scheduled_date,
      priority: workOrderRecord.priority,
      amount: workOrderRecord.amount,
      currency: workOrderRecord.currency,
      nteAmount: null, // Legacy doesn't have nte_amount
      status: workOrderRecord.status || "OPEN",
      notes: workOrderRecord.notes,
      workOrderPdfLink: workOrderRecord.work_order_pdf_link,
      signedPdfUrl: workOrderRecord.signed_pdf_url,
      signedPreviewImageUrl: workOrderRecord.signed_preview_image_url,
      signedAt: workOrderRecord.signed_at || null,
      createdAt: workOrderRecord.created_at || new Date().toISOString(),
      updatedAt: workOrderRecord.last_updated_at || null,
      fmKey: workOrderRecord.fmKey,
      fmDisplayName: workOrderRecord.fmKey, // Legacy doesn't have display name
      sources: [], // Legacy doesn't have sources
      signedDocument: null, // Legacy doesn't have signed document details
      latestExtractionRun: null, // Legacy doesn't have extraction runs
      exportJobs: [], // Legacy doesn't have export jobs
    };

    return {
      workOrder: unified,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  } catch (error) {
    console.error("[Read Adapter Detail] Legacy read failed:", error);
    return {
      workOrder: null,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  }
}
