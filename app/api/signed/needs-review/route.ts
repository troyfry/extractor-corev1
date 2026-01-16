import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";
import { SIGNED_NEEDS_REVIEW_SHEET_NAME, SIGNED_NEEDS_REVIEW_COLUMNS } from "@/lib/workOrders/signedSheets";
import { getColumnRange } from "@/lib/google/sheetsCache";

export const runtime = "nodejs";

/**
 * GET /api/signed/needs-review
 * Get signed documents that need review.
 * 
 * Uses read adapter to route to DB or legacy based on feature flag + workspace setting.
 * Falls back to legacy if DB read fails.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Google access token not found." },
        { status: 400 }
      );
    }

    // Use read adapter (routes to DB or legacy based on feature flag + workspace setting)
    const { listSignedDocsUnified } = await import("@/lib/readAdapter/signedDocs");
    const result = await listSignedDocsUnified({
      decision: "NEEDS_REVIEW", // Filter to needs review items
      limit: 100, // Reasonable limit
    });

    // Filter to needs review items (unmatched or needs review decision)
    const needsReviewItems = result.items.filter(
      (doc) => doc.decision === "UNMATCHED" || doc.decision === "NEEDS_REVIEW"
    );

    // Map unified format to legacy format for backward compatibility
    const items = needsReviewItems.map((doc) => ({
      review_id: doc.id,
      created_at: doc.createdAt,
      fmKey: doc.fmKey,
      signed_pdf_url: doc.signedPdfUrl,
      preview_image_url: doc.signedPreviewImageUrl, // This is the snippet image
      raw_text: null, // Not in unified format
      confidence: doc.extractionConfidence,
      reason: doc.extractionRationale || "Needs review",
      manual_work_order_number: doc.extractedWorkOrderNumber,
      resolved: doc.decision === "MATCHED" ? "TRUE" : null,
      resolved_at: doc.decision === "MATCHED" ? doc.createdAt : null,
      reason_note: null,
      extraction_method: doc.extractionMethod,
      extraction_confidence: doc.extractionConfidence,
      extraction_rationale: doc.extractionRationale,
      extracted_work_order_number: doc.extractedWorkOrderNumber,
      snippet_url: doc.signedPreviewImageUrl, // Alias for snippet image
    }));

    // Rehydrate cookies if needed (for legacy compatibility)
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const workspaceResult = await getWorkspace();
    
    const response = NextResponse.json({ 
      items,
      dataSource: result.dataSource, // Include data source in response
      fallbackUsed: result.fallbackUsed, // Include fallback indicator
    });
    
    if (workspaceResult && workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    
    return response;
  } catch (error) {
    console.error("Error in GET /api/signed/needs-review", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Check if this is a DB error in strict mode
    if (errorMessage.includes("Database unavailable")) {
      return NextResponse.json(
        { 
          error: errorMessage,
          code: "DB_UNAVAILABLE",
        },
        { status: 503 } // 503 Service Unavailable
      );
    }
    
    return NextResponse.json(
      { error: "Failed to fetch verification items." },
      { status: 500 }
    );
  }
}

