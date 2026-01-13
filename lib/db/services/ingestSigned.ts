// lib/db/services/ingestSigned.ts
import { db } from "../drizzle";
import {
  signed_documents,
  signed_match,
  work_orders,
  export_jobs,
} from "../schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

export interface IngestSignedInput {
  workspaceId: string;
  pdfBuffer: Buffer;
  signedPdfUrl: string | null; // Can be null if upload fails or not yet uploaded
  signedPreviewImageUrl?: string | null;
  fmKey?: string | null;
  extractionResult?: {
    workOrderNumber: string | null;
    method: "DIGITAL_TEXT" | "OCR" | "AI_RESCUE";
    confidence: number;
    rationale?: string;
    candidates?: Array<{
      value: string;
      score: number;
      source: "DIGITAL_TEXT" | "OCR" | "AI_RESCUE";
      sourceSnippet?: string;
    }>;
  } | null;
  sourceMetadata?: {
    messageId?: string;
    attachmentId?: string;
    gmailDate?: string;
    [key: string]: unknown;
  };
  workOrderNumber?: string | null; // Optional override
}

/**
 * Idempotent signed document ingestion.
 * Uses file_hash for deduplication.
 * Enforces 1:1 match with work orders via signed_match table.
 * Returns signed_document_id and whether it was newly created.
 */
export async function ingestSignedAuthoritative(
  input: IngestSignedInput
): Promise<{
  signedDocumentId: string;
  isNew: boolean;
  matchedWorkOrderId: string | null;
}> {
  const {
    workspaceId,
    pdfBuffer,
    signedPdfUrl,
    signedPreviewImageUrl,
    fmKey,
    extractionResult,
    sourceMetadata,
    workOrderNumber,
  } = input;

  // Generate file hash for deduplication
  const fileHash = createHash("sha256").update(pdfBuffer).digest("hex");

  // Check if this signed document already exists
  const existingSigned = await db
    .select()
    .from(signed_documents)
    .where(eq(signed_documents.file_hash, fileHash))
    .limit(1);

  let signedDocumentId: string;
  let isNew: boolean;

  if (existingSigned.length > 0) {
    signedDocumentId = existingSigned[0].id;
    isNew = false;
  } else {
    // Create new signed document
    signedDocumentId = randomUUID();
    isNew = true;

    const extractedWoNumber =
      workOrderNumber ||
      extractionResult?.workOrderNumber ||
      null;

    await db.insert(signed_documents).values({
      id: signedDocumentId,
      workspace_id: workspaceId,
      file_hash: fileHash,
      signed_pdf_url: signedPdfUrl || null, // Allow null if not yet uploaded
      signed_preview_image_url: signedPreviewImageUrl || null,
      fm_key: fmKey || null,
      extraction_method: extractionResult?.method || null,
      extraction_confidence: extractionResult?.confidence
        ? String(extractionResult.confidence)
        : null,
      extraction_rationale: extractionResult?.rationale || null,
      extracted_work_order_number: extractedWoNumber,
      source_metadata: sourceMetadata || null,
    });
  }

  // Try to match with work order (1:1 enforcement)
  let matchedWorkOrderId: string | null = null;

  const woNumberToMatch =
    workOrderNumber || extractionResult?.workOrderNumber;

  if (woNumberToMatch) {
    // Find work order by workspace + work_order_number
    const matchingWorkOrder = await db
      .select()
      .from(work_orders)
      .where(
        and(
          eq(work_orders.workspace_id, workspaceId),
          eq(work_orders.work_order_number, woNumberToMatch)
        )
      )
      .limit(1);

    if (matchingWorkOrder.length > 0) {
      const candidateWorkOrderId = matchingWorkOrder[0].id;

      // Check if this work order already has a signed document (1:1 enforcement)
      const existingMatch = await db
        .select()
        .from(signed_match)
        .where(eq(signed_match.work_order_id, candidateWorkOrderId))
        .limit(1);

      if (existingMatch.length === 0) {
        // No existing match - create new match
        try {
          await db.insert(signed_match).values({
            work_order_id: candidateWorkOrderId,
            signed_document_id: signedDocumentId,
          });

          matchedWorkOrderId = candidateWorkOrderId;

          // Update work order with signed info
          await db
            .update(work_orders)
            .set({
              status: "SIGNED",
              signed_pdf_url: signedPdfUrl || null, // Allow null if not yet uploaded
              signed_preview_image_url: signedPreviewImageUrl || null,
              signed_at: new Date(),
              updated_at: new Date(),
            })
            .where(eq(work_orders.id, candidateWorkOrderId));

          // Enqueue export job for signed match
          try {
            await db.insert(export_jobs).values({
              id: randomUUID(),
              workspace_id: workspaceId,
              job_type: "SIGNED_MATCH",
              entity_id: candidateWorkOrderId,
              status: "PENDING",
            });
          } catch (error) {
            // Ignore duplicate key errors
            if (
              !(
                error instanceof Error &&
                error.message.includes("unique constraint")
              )
            ) {
              throw error;
            }
          }
        } catch (error) {
          // Ignore duplicate key errors (idempotency)
          if (
            !(error instanceof Error && error.message.includes("unique constraint"))
          ) {
            throw error;
          }
          // Match already exists - get existing match
          const existing = await db
            .select()
            .from(signed_match)
            .where(eq(signed_match.work_order_id, candidateWorkOrderId))
            .limit(1);
          if (existing.length > 0) {
            matchedWorkOrderId = candidateWorkOrderId;
          }
        }
      } else {
        // Work order already has a signed document - cannot create duplicate match
        // This enforces 1:1 relationship
        matchedWorkOrderId = null;
      }
    }
  }

  // Enqueue export job for signed document
  try {
    await db.insert(export_jobs).values({
      id: randomUUID(),
      workspace_id: workspaceId,
      job_type: "SIGNED_DOCUMENT",
      entity_id: signedDocumentId,
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

  return {
    signedDocumentId,
    isNew,
    matchedWorkOrderId,
  };
}
