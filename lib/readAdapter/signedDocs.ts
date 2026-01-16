// lib/readAdapter/signedDocs.ts
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getPrimaryReadSource } from "@/lib/db/services/workspace";
import { listSignedDocs } from "@/lib/db/services/signedDocs";

export interface UnifiedSignedDoc {
  id: string;
  extractedWorkOrderNumber: string | null;
  extractionMethod: string | null;
  extractionConfidence: string | null;
  extractionRationale: string | null;
  signedPdfUrl: string | null;
  signedPreviewImageUrl: string | null;
  fmKey: string | null;
  matchedWorkOrderId: string | null;
  matchedWorkOrderNumber: string | null;
  decision: "MATCHED" | "UNMATCHED" | "ALREADY_ATTACHED" | "NEEDS_REVIEW";
  createdAt: string;
}

export interface ListSignedDocsUnifiedParams {
  decision?: "MATCHED" | "UNMATCHED" | "NEEDS_REVIEW" | "ALREADY_ATTACHED";
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ListSignedDocsUnifiedResult {
  items: UnifiedSignedDoc[];
  nextCursor: string | null;
  hasMore: boolean;
  dataSource: "DB" | "LEGACY";
  fallbackUsed: boolean;
}

import { isDbStrictMode, isDbNativeMode } from "./guardrails";

/**
 * Unified signed docs list adapter.
 * DB-only reads - no fallback to Sheets.
 * Sheets is export-only.
 */
export async function listSignedDocsUnified(
  params: ListSignedDocsUnifiedParams = {}
): Promise<ListSignedDocsUnifiedResult> {
  const { decision, search, limit, cursor } = params;

  // Get workspace ID (required for DB reads)
  const workspaceId = await getWorkspaceIdForUser();
  if (!workspaceId) {
    throw new Error("No workspace found. Please complete onboarding.");
  }

  // Read from DB only - no fallback
  const dbResult = await listSignedDocs(
    workspaceId,
    {
      decision,
      search,
    },
    {
      limit,
      cursor,
    }
  );

  // Map DB result to unified format
  const unifiedItems: UnifiedSignedDoc[] = dbResult.items.map((doc) => ({
    id: doc.id,
    extractedWorkOrderNumber: doc.extracted_work_order_number,
    extractionMethod: doc.extraction_method,
    extractionConfidence: doc.extraction_confidence,
    extractionRationale: doc.extraction_rationale,
    signedPdfUrl: doc.signed_pdf_url,
    signedPreviewImageUrl: doc.signed_preview_image_url,
    fmKey: doc.fm_key,
    matchedWorkOrderId: doc.matched_work_order_id,
    matchedWorkOrderNumber: doc.matched_work_order_number,
    decision: doc.decision,
    createdAt: doc.created_at.toISOString(),
  }));

  return {
    items: unifiedItems,
    nextCursor: dbResult.nextCursor,
    hasMore: dbResult.hasMore,
    dataSource: "DB",
    fallbackUsed: false,
  };
}

/**
 * Legacy signed docs list (from Sheets).
 * This reads from the Signed_Needs_Review sheet.
 */
async function listSignedDocsLegacy(
  params: ListSignedDocsUnifiedParams
): Promise<ListSignedDocsUnifiedResult> {
  // Import legacy service functions
  const { getCurrentUser } = await import("@/lib/auth/currentUser");
  const { workspaceRequired } = await import("@/lib/workspace/workspaceRequired");
  const { createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");

  const user = await getCurrentUser();
  
  if (!user || !user.googleAccessToken) {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  }

  try {
    // Get workspace
    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;
    const SIGNED_NEEDS_REVIEW_SHEET_NAME = process.env.GOOGLE_SHEETS_SIGNED_NEEDS_REVIEW_SHEET_NAME || "Signed_Needs_Review";

    const sheets = createSheetsClient(user.googleAccessToken);

    // Read from Signed_Needs_Review sheet
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(SIGNED_NEEDS_REVIEW_SHEET_NAME, "A:Z"),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
        dataSource: "LEGACY",
        fallbackUsed: false,
      };
    }

    // First row is headers
    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => (h || "").toLowerCase().trim());
    const getIndex = (colName: string): number => headersLower.indexOf(colName.toLowerCase());

    // Map data rows to unified format
    const unifiedItems: UnifiedSignedDoc[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const extractedWoNumber = getIndex("extracted_work_order_number") !== -1
        ? String(row[getIndex("extracted_work_order_number")] || "").trim()
        : null;
      const resolved = getIndex("resolved") !== -1
        ? String(row[getIndex("resolved")] || "").trim()
        : null;

      // Determine decision based on resolved status
      let decision: "MATCHED" | "UNMATCHED" | "ALREADY_ATTACHED" | "NEEDS_REVIEW" = "NEEDS_REVIEW";
      if (resolved === "TRUE" || resolved === "true") {
        decision = "MATCHED";
      } else if (resolved === "FALSE" || resolved === "false") {
        decision = "UNMATCHED";
      }

      // Apply filters if provided
      if (params.decision && decision !== params.decision) {
        continue;
      }

      if (params.search) {
        const query = params.search.toLowerCase();
        const matchesWoNumber = extractedWoNumber?.toLowerCase().includes(query) || false;
        if (!matchesWoNumber) {
          continue;
        }
      }

      unifiedItems.push({
        id: `legacy-${i}`,
        extractedWorkOrderNumber: extractedWoNumber,
        extractionMethod: getIndex("extraction_method") !== -1
          ? String(row[getIndex("extraction_method")] || "")
          : null,
        extractionConfidence: getIndex("extraction_confidence") !== -1
          ? String(row[getIndex("extraction_confidence")] || "")
          : null,
        extractionRationale: getIndex("extraction_rationale") !== -1
          ? String(row[getIndex("extraction_rationale")] || "")
          : null,
        signedPdfUrl: getIndex("signed_pdf_url") !== -1
          ? String(row[getIndex("signed_pdf_url")] || "").trim()
          : null,
        signedPreviewImageUrl: getIndex("preview_image_url") !== -1
          ? String(row[getIndex("preview_image_url")] || "").trim()
          : null,
        fmKey: getIndex("fmkey") !== -1
          ? String(row[getIndex("fmkey")] || "").trim()
          : null,
        matchedWorkOrderId: null, // Legacy doesn't have matched work order ID
        matchedWorkOrderNumber: extractedWoNumber, // Use extracted WO number as matched
        decision,
        createdAt: getIndex("created_at") !== -1
          ? String(row[getIndex("created_at")] || new Date().toISOString())
          : new Date().toISOString(),
      });
    }

    // Apply limit if provided (client-side pagination for legacy)
    const limitedItems = params.limit 
      ? unifiedItems.slice(0, params.limit)
      : unifiedItems;

    return {
      items: limitedItems,
      nextCursor: null, // Legacy doesn't support cursor pagination
      hasMore: params.limit ? unifiedItems.length > params.limit : false,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  } catch (error) {
    console.error("[Read Adapter Signed] Legacy read failed:", error);
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  }
}
