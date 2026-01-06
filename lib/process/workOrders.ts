/**
 * Process Access Layer - Work Order Processing Operations
 * 
 * Wrappers for work order processing (signed PDFs, Gmail batch processing).
 * All work order processing goes through this module.
 */

import { processSignedPdfUnified, type ProcessSignedPdfParams, type ProcessSignedPdfResult } from "@/lib/signed/processor";
import { pdfInputToBuffer, type PdfInput } from "./types";

/**
 * Process a signed PDF work order.
 * 
 * This wraps the unified signed PDF processor with consistent logging.
 * 
 * @param params - Processing parameters (same as ProcessSignedPdfParams)
 * @returns Processing result with work order number, review status, and metadata
 */
export async function processSignedPdf(
  params: ProcessSignedPdfParams & { pdf?: PdfInput }
): Promise<ProcessSignedPdfResult> {
  // Convert pdf input to bytes if provided
  let pdfBytes = params.pdfBytes;
  if (params.pdf) {
    const pdfBuffer = await pdfInputToBuffer(params.pdf);
    pdfBytes = pdfBuffer;
  }

  if (!pdfBytes) {
    throw new Error("pdfBytes or pdf must be provided");
  }

  // Log operation
  console.log("[process/workOrders] processSignedPdf", {
    fmKey: params.fmKey,
    page: params.page,
    source: params.source,
  });

  // Call unified processor
  const result = await processSignedPdfUnified({
    ...params,
    pdfBytes,
  });

  return result;
}

/**
 * Process work orders from Gmail.
 * 
 * This is a placeholder for future Gmail batch processing.
 * Currently, Gmail processing is handled directly in the API route.
 * 
 * TODO: Extract Gmail processing logic into this function when refactoring.
 */
export async function processWorkOrdersFromGmail(
  params: {
    fmKey: string;
    accessToken: string;
    spreadsheetId: string;
    messageIds?: string[];
    query?: string;
    maxMessages?: number;
    maxAttachments?: number;
    newerThanDays?: number;
    labelIds?: string[];
  }
): Promise<{
  ok: boolean;
  fmKey: string;
  queryUsed: string;
  scannedMessages: number;
  scannedAttachments: number;
  results: {
    updated: number;
    needsReview: number;
    blocked: number;
    alreadyProcessed: number;
    errors: number;
  };
  items: Array<{
    filename: string;
    messageId: string;
    attachmentId?: string;
    status: "UPDATED" | "NEEDS_REVIEW" | "BLOCKED" | "ALREADY_PROCESSED" | "ERROR";
    woNumber?: string | null;
    reason?: string | null;
    signedPdfUrl?: string | null;
    fileHash?: string;
    filenameHint?: string | null;
    fixHref?: string | null;
    fixAction?: string | null;
    reasonTitle?: string | null;
    reasonMessage?: string | null;
    snippetImageUrl?: string | null;
    snippetDriveUrl?: string | null;
    fmKey?: string;
  }>;
}> {
  // Log operation
  console.log("[process/workOrders] processWorkOrdersFromGmail", {
    fmKey: params.fmKey,
    messageIds: params.messageIds?.length ?? 0,
    query: params.query,
  });

  // TODO: Extract Gmail processing logic from app/api/signed/gmail/process/route.ts
  // For now, this is a placeholder that indicates the function exists but needs implementation
  throw new Error("processWorkOrdersFromGmail is not yet implemented. Use the API route directly.");
}

