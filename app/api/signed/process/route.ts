import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { processSignedPdfUnified } from "@/lib/signed/processor";
import { normalizePdfBuffer } from "@/lib/pdf/normalizePdf";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      console.log("[Signed Process] No user found");
      return new Response("Unauthorized", { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
      console.log("[Signed Process] No Google access token");
      return NextResponse.json(
        {
          error:
            "Google access token not found. Please reconnect your Google account in Settings.",
        },
        { status: 400 }
      );
    }

    // Get workspace (centralized resolution)
    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      console.log("[Signed Process] No file uploaded");
      return NextResponse.json(
        { error: "No signed PDF uploaded." },
        { status: 400 }
      );
    }

    const rawFmKey = (formData.get("fmKey") as string | null)?.trim() || "";
    if (!rawFmKey) {
      console.log("[Signed Process] No fmKey provided");
      return NextResponse.json(
        { error: "fmKey is required to process signed work orders." },
        { status: 400 }
      );
    }

    const woNumberOverride =
      (formData.get("woNumber") as string | null) || null;
    const manualReason = (formData.get("reason") as string | null) || null;
    const pageOverride = formData.get("page");
    const pageNumber = pageOverride ? parseInt(String(pageOverride), 10) : 1;

    const arrayBuffer = await file.arrayBuffer();
    const originalPdfBuffer = Buffer.from(arrayBuffer);
    const originalFilename = file.name || "signed-work-order.pdf";
    const originalSize = originalPdfBuffer.length;

    // Normalize PDF before processing (fixes coordinate systems and bounds)
    console.log("🔧 [NORMALIZATION] Starting PDF normalization before signed processing:", {
      filename: originalFilename,
      originalSize,
      timestamp: new Date().toISOString(),
    });
    
    const normalizedPdfBuffer = await normalizePdfBuffer(originalPdfBuffer);
    const normalizedSize = normalizedPdfBuffer.length;
    
    if (normalizedPdfBuffer !== originalPdfBuffer) {
      console.log("✅ [NORMALIZATION] PDF NORMALIZED SUCCESSFULLY before signed processing:", {
        filename: originalFilename,
        originalSize,
        normalizedSize,
        sizeChange: normalizedSize - originalSize,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log("ℹ️ [NORMALIZATION] PDF did not require normalization (already normalized or normalization not available):", {
        filename: originalFilename,
        size: originalSize,
        timestamp: new Date().toISOString(),
      });
    }

    // Call unified processor with normalized PDF
    const result = await processSignedPdfUnified({
      pdfBytes: normalizedPdfBuffer,
      originalFilename,
      page: pageNumber,
      fmKey: rawFmKey,
      spreadsheetId,
      accessToken,
      source: "UPLOAD",
      dpi: 200,
      woNumberOverride: woNumberOverride || undefined,
      manualReason: manualReason || undefined,
    });

    // Map unified result to existing response format for compatibility
    const responseData = {
      mode: result.needsReview ? "NEEDS_REVIEW" as const : "UPDATED" as const,
      data: {
        fmKey: rawFmKey,
        woNumber: result.workOrderNumber,
        ocrConfidenceLabel: result.confidenceLabel,
        ocrConfidenceRaw: result.confidence,
        confidenceLabel: result.confidenceLabel,
        confidenceRaw: result.confidence,
        automationStatus: result.needsReview ? "REVIEW" as const : "APPLIED" as const,
        automationBlocked: false,
        automationBlockReason: null,
        signedPdfUrl: result.signedPdfUrl || null,
        snippetImageUrl: result.snippetImageUrl || null,
        snippetDriveUrl: result.snippetDriveUrl || null,
        jobExistsInSheet1: false, // Will be determined by processor
        retryAttempted: false,
        alternatePageAttempted: false,
        reason: result.needsReview ? "Low confidence or no work order number extracted" : null,
        templateUsed: {
          templateId: result.debug?.templateId || null,
          fmKey: rawFmKey,
          page: result.debug?.page || null,
          region: null,
          dpi: 200,
          coordSystem: null,
          xPt: null,
          yPt: null,
          wPt: null,
          hPt: null,
          pageWidthPt: null,
          pageHeightPt: null,
        },
        chosenPage: result.debug?.page || null,
        attemptedPages: String(result.debug?.page || ""),
      },
    };

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json(responseData, { status: 200 });
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }

    return response;
  } catch (error) {
    console.error("Error in POST /api/signed/process", error);
    const message =
      error instanceof Error ? error.message : "Failed to process signed work order";
    return NextResponse.json(
      {
        error: "Failed to process signed work order.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
