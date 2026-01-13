// lib/db/services/signedDocs.ts
import { db } from "../drizzle";
import {
  signed_documents,
  signed_match,
  work_orders,
} from "../schema";
import { eq, and, or, desc, sql, ilike, isNull, isNotNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

export type SignedDocListItem = InferSelectModel<typeof signed_documents> & {
  matched_work_order_id: string | null;
  matched_work_order_number: string | null;
  decision: "MATCHED" | "UNMATCHED";
};

export interface ListSignedDocsFilters {
  decision?: "MATCHED" | "UNMATCHED";
  search?: string; // Search in extracted_work_order_number
}

export interface PaginationParams {
  limit?: number;
  cursor?: string; // signed_document.id for cursor-based pagination
}

export interface ListSignedDocsResult {
  items: SignedDocListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * List signed documents with filters and pagination.
 * Enforces workspace_id scoping.
 */
export async function listSignedDocs(
  workspaceId: string,
  filters: ListSignedDocsFilters = {},
  pagination: PaginationParams = {}
): Promise<ListSignedDocsResult> {
  const limit = Math.min(pagination.limit || 20, 100); // Max 100 per page
  const cursor = pagination.cursor;

  // Build WHERE conditions
  const conditions = [eq(signed_documents.workspace_id, workspaceId)];

  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(
      ilike(signed_documents.extracted_work_order_number, searchPattern)
    );
  }

  // Cursor-based pagination
  if (cursor) {
    conditions.push(sql`${signed_documents.id} < ${cursor}`);
  }

  // Main query with left join to signed_match and work_orders
  const query = db
    .select({
      // Signed document fields
      id: signed_documents.id,
      workspace_id: signed_documents.workspace_id,
      file_hash: signed_documents.file_hash,
      signed_pdf_url: signed_documents.signed_pdf_url,
      signed_preview_image_url: signed_documents.signed_preview_image_url,
      fm_key: signed_documents.fm_key,
      extraction_method: signed_documents.extraction_method,
      extraction_confidence: signed_documents.extraction_confidence,
      extraction_rationale: signed_documents.extraction_rationale,
      extracted_work_order_number: signed_documents.extracted_work_order_number,
      source_metadata: signed_documents.source_metadata,
      created_at: signed_documents.created_at,
      // Match info
      matched_work_order_id: work_orders.id,
      matched_work_order_number: work_orders.work_order_number,
    })
    .from(signed_documents)
    .leftJoin(signed_match, eq(signed_match.signed_document_id, signed_documents.id))
    .leftJoin(work_orders, eq(work_orders.id, signed_match.work_order_id))
    .where(and(...conditions))
    .orderBy(desc(signed_documents.created_at))
    .limit(limit + 1); // Fetch one extra to check if there's more

  const results = await query;

  // Check if there are more results
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;

  // Filter by decision if specified
  let filteredItems = items;
  if (filters.decision === "MATCHED") {
    filteredItems = items.filter((item) => item.matched_work_order_id !== null);
  } else if (filters.decision === "UNMATCHED") {
    filteredItems = items.filter((item) => item.matched_work_order_id === null);
  }

  // Get next cursor (last item's id)
  const nextCursor = filteredItems.length > 0 ? filteredItems[filteredItems.length - 1].id : null;

  return {
    items: filteredItems.map((row) => ({
      ...row,
      matched_work_order_id: row.matched_work_order_id || null,
      matched_work_order_number: row.matched_work_order_number || null,
      decision: row.matched_work_order_id ? "MATCHED" as const : "UNMATCHED" as const,
    })),
    nextCursor,
    hasMore,
  };
}
