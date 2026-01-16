// lib/db/services/ingestWorkOrder.ts
import { db } from "../drizzle";
import {
  work_orders,
  work_order_sources,
  export_jobs,
} from "../schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { ParsedWorkOrder } from "@/lib/workOrders/parsedTypes";
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";
import { getOrCreateWorkspace } from "./workspace";

export interface IngestWorkOrderInput {
  workspaceId: string;
  userId: string;
  spreadsheetId: string;
  parsedWorkOrder: ParsedWorkOrder;
  pdfBuffer?: Buffer;
  sourceType: "GMAIL" | "MANUAL_UPLOAD" | "DRIVE";
  workOrderPdfLink?: string | null; // PDF link from Drive upload (optional)
  sourceMetadata?: {
    messageId?: string;
    attachmentId?: string;
    filename?: string;
    emailSubject?: string;
    [key: string]: unknown;
  };
}

/**
 * Idempotent work order ingestion.
 * Uses file_hash for deduplication.
 * Returns work_order_id and whether it was newly created.
 */
export async function ingestWorkOrderAuthoritative(
  input: IngestWorkOrderInput
): Promise<{ workOrderId: string; isNew: boolean }> {
  const {
    workspaceId,
    userId,
    parsedWorkOrder,
    pdfBuffer,
    sourceType,
    workOrderPdfLink,
    sourceMetadata,
  } = input;

  // Generate file hash for deduplication
  const fileHash = pdfBuffer
    ? createHash("sha256").update(pdfBuffer).digest("hex")
    : createHash("sha256")
        .update(
          JSON.stringify({
            woNumber: parsedWorkOrder.workOrderNumber,
            source: sourceType,
            metadata: sourceMetadata,
          })
        )
        .digest("hex");

  // Check if this source already exists (deduplication)
  const existingSource = await db
    .select()
    .from(work_order_sources)
    .where(eq(work_order_sources.file_hash, fileHash))
    .limit(1);

  if (existingSource.length > 0) {
    // Already ingested - return existing work order ID
    return {
      workOrderId: existingSource[0].work_order_id,
      isNew: false,
    };
  }

  // Generate job ID (consistent with Sheets logic)
  const issuerKey =
    parsedWorkOrder.fmKey || sourceMetadata?.emailSubject || "unknown";
  const jobId = generateJobId(issuerKey, parsedWorkOrder.workOrderNumber);

  // Check if work order already exists (by workspace + job_id)
  let existingWorkOrder = await db
    .select()
    .from(work_orders)
    .where(
      and(
        eq(work_orders.workspace_id, workspaceId),
        eq(work_orders.job_id, jobId)
      )
    )
    .limit(1);

  // Fallback: If not found by job_id, check by work_order_number + fm_key to prevent duplicates
  // This handles cases where issuerKey varies (different email subjects) but it's the same work order
  if (existingWorkOrder.length === 0 && parsedWorkOrder.workOrderNumber && parsedWorkOrder.fmKey) {
    const fallbackCheck = await db
      .select()
      .from(work_orders)
      .where(
        and(
          eq(work_orders.workspace_id, workspaceId),
          eq(work_orders.work_order_number, parsedWorkOrder.workOrderNumber),
          eq(work_orders.fm_key, parsedWorkOrder.fmKey)
        )
      )
      .limit(1);
    
    if (fallbackCheck.length > 0) {
      // Found existing work order by work_order_number + fm_key
      // Use its job_id to maintain consistency
      existingWorkOrder = fallbackCheck;
      // Update job_id to match the existing one (or keep the new one if they're different)
      // Actually, let's keep the existing job_id to avoid breaking references
    }
  }

  let workOrderId: string;
  let isNew: boolean;
  let shouldUpdateJobId = false;

  if (existingWorkOrder.length > 0) {
    // Update existing work order (idempotent - field authority merge policy)
    workOrderId = existingWorkOrder[0].id;
    isNew = false;
    
    // If job_id differs but it's the same work order, update job_id to the new one for consistency
    if (existingWorkOrder[0].job_id !== jobId) {
      shouldUpdateJobId = true;
    }

    const existing = existingWorkOrder[0];
    const updates: Partial<typeof work_orders.$inferInsert> = {
      updated_at: new Date(),
    };

    // Field authority merge policy:
    // - Never overwrite non-null canonical fields with nulls
    // - Never overwrite signed_* fields unless new signed data is present
    // - Only update if new value is provided and existing is null/empty

    if (parsedWorkOrder.customerName && !existing.customer_name) {
      updates.customer_name = parsedWorkOrder.customerName;
    }
    if (parsedWorkOrder.serviceAddress && !existing.service_address) {
      updates.service_address = parsedWorkOrder.serviceAddress;
    }
    if (parsedWorkOrder.jobType && !existing.job_type) {
      updates.job_type = parsedWorkOrder.jobType;
    }
    if (parsedWorkOrder.jobDescription && !existing.job_description) {
      updates.job_description = parsedWorkOrder.jobDescription;
    }
    if (parsedWorkOrder.vendorName && !existing.vendor_name) {
      updates.vendor_name = parsedWorkOrder.vendorName;
    }
    // Scheduled date: prefer new value if it's different from existing (field authority)
    if (parsedWorkOrder.scheduledDate) {
      // Only update if existing is null/empty or if new value is different
      if (!existing.scheduled_date || existing.scheduled_date !== parsedWorkOrder.scheduledDate) {
        updates.scheduled_date = parsedWorkOrder.scheduledDate;
      }
    }
    if (parsedWorkOrder.priority && !existing.priority) {
      updates.priority = parsedWorkOrder.priority;
    }
    if (parsedWorkOrder.amount && !existing.amount) {
      updates.amount = parsedWorkOrder.amount;
    }
    if (parsedWorkOrder.currency && !existing.currency) {
      updates.currency = parsedWorkOrder.currency;
    }
    if (parsedWorkOrder.notes && !existing.notes) {
      updates.notes = parsedWorkOrder.notes;
    }
    if (workOrderPdfLink && !existing.work_order_pdf_link) {
      updates.work_order_pdf_link = workOrderPdfLink;
    }

    // Never overwrite signed fields (signed_pdf_url, signed_preview_image_url, signed_at, status=SIGNED)
    // These are only set by signed document processing

    // Update job_id if it changed (for consistency when same work order has different issuer keys)
    if (shouldUpdateJobId) {
      updates.job_id = jobId;
    }

    if (Object.keys(updates).length > 1) {
      // More than just updated_at
      await db
        .update(work_orders)
        .set(updates)
        .where(eq(work_orders.id, workOrderId));
    }
  } else {
    // Create new work order
    workOrderId = randomUUID();
    isNew = true;

    await db.insert(work_orders).values({
      id: workOrderId,
      workspace_id: workspaceId,
      job_id: jobId,
      work_order_number: parsedWorkOrder.workOrderNumber || null,
      fm_key: parsedWorkOrder.fmKey || null,
      customer_name: parsedWorkOrder.customerName || null,
      service_address: parsedWorkOrder.serviceAddress || null,
      job_type: parsedWorkOrder.jobType || null,
      job_description: parsedWorkOrder.jobDescription || null,
      vendor_name: parsedWorkOrder.vendorName || null,
      scheduled_date: parsedWorkOrder.scheduledDate || null,
      priority: parsedWorkOrder.priority || null,
      amount: parsedWorkOrder.amount || null,
      currency: parsedWorkOrder.currency || "USD",
      nte_amount: (() => {
        // Extract NTE amount from notes if present (format: "NTE: $123.45" or "NTE: 123.45")
        if (parsedWorkOrder.notes) {
          const nteMatch = parsedWorkOrder.notes.match(/NTE:\s*\$?([0-9,]+\.?[0-9]*)/i);
          if (nteMatch) {
            const nteValue = nteMatch[1].replace(/,/g, "");
            const nteNum = parseFloat(nteValue);
            if (!isNaN(nteNum)) {
              return nteNum.toFixed(2);
            }
          }
        }
        return null;
      })(),
      notes: parsedWorkOrder.notes || null,
      work_order_pdf_link: workOrderPdfLink || null,
      status: "OPEN",
    });
  }

  // Create source record (idempotent - unique constraint on file_hash prevents duplicates)
  try {
    await db.insert(work_order_sources).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      work_order_id: workOrderId,
      source_type: sourceType,
      file_hash: fileHash,
      source_metadata: sourceMetadata || null,
    });
  } catch (error) {
    // Ignore duplicate key errors (idempotency)
    if (
      !(error instanceof Error && error.message.includes("unique constraint"))
    ) {
      throw error;
    }
  }

  // Enqueue export job (idempotent - will be deduplicated by entity_id)
  try {
    await db.insert(export_jobs).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      job_type: "WORK_ORDER",
      entity_id: workOrderId,
      status: "PENDING",
    });
  } catch (error) {
    // Ignore duplicate key errors (idempotency)
    if (
      !(error instanceof Error && error.message.includes("unique constraint"))
    ) {
      throw error;
    }
  }

  return { workOrderId, isNew };
}
