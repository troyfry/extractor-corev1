import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { processSignedPdf } from "@/lib/_deprecated/process";
import { normalizePdfBuffer } from "@/lib/pdf/normalizePdf";
import { extractWorkOrderNumber } from "@/lib/signed/extractWorkOrderNumber";
import { getTemplateConfigForFmKey } from "@/lib/workOrders/templateConfig";
import { useUserOpenAIKey } from "@/lib/useUserOpenAIKey";

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

    // Get AI settings from headers (for 3-layer extraction)
    const aiEnabled = req.headers.get("x-ai-enabled") === "true";
    const openaiKey = req.headers.get("x-openai-key")?.trim() || null;

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

    // Step: Run 3-layer extraction flow (Digital → OCR → AI Rescue)
    let extractionResult = null;
    try {
      // Try to get template config for OCR coordinates (optional)
      let ocrConfig = null;
      try {
        const templateConfig = await getTemplateConfigForFmKey(rawFmKey);
        console.log("[Signed Process] Template config loaded:", {
          fmKey: rawFmKey,
          templateId: templateConfig.templateId,
          hasCoordinates: !!(templateConfig.xPt !== undefined &&
            templateConfig.yPt !== undefined &&
            templateConfig.wPt !== undefined &&
            templateConfig.hPt !== undefined &&
            templateConfig.pageWidthPt !== undefined &&
            templateConfig.pageHeightPt !== undefined),
          coordinates: {
            xPt: templateConfig.xPt,
            yPt: templateConfig.yPt,
            wPt: templateConfig.wPt,
            hPt: templateConfig.hPt,
            pageWidthPt: templateConfig.pageWidthPt,
            pageHeightPt: templateConfig.pageHeightPt,
          },
        });
        
        if (
          templateConfig.xPt !== undefined &&
          templateConfig.yPt !== undefined &&
          templateConfig.wPt !== undefined &&
          templateConfig.hPt !== undefined &&
          templateConfig.pageWidthPt !== undefined &&
          templateConfig.pageHeightPt !== undefined
        ) {
          ocrConfig = {
            page: pageNumber,
            xPt: templateConfig.xPt,
            yPt: templateConfig.yPt,
            wPt: templateConfig.wPt,
            hPt: templateConfig.hPt,
            pageWidthPt: templateConfig.pageWidthPt,
            pageHeightPt: templateConfig.pageHeightPt,
            dpi: 200,
          };
          console.log("[Signed Process] OCR config created:", ocrConfig);
        } else {
          console.warn("[Signed Process] Template config missing required coordinates:", {
            xPt: templateConfig.xPt,
            yPt: templateConfig.yPt,
            wPt: templateConfig.wPt,
            hPt: templateConfig.hPt,
            pageWidthPt: templateConfig.pageWidthPt,
            pageHeightPt: templateConfig.pageHeightPt,
          });
        }
      } catch (error) {
        // Template not found - OCR config will be null (extraction will skip OCR layer)
        console.error("[Signed Process] Template config not available for OCR, will skip OCR layer:", error);
      }

      extractionResult = await extractWorkOrderNumber({
        pdfBuffer: normalizedPdfBuffer,
        aiEnabled,
        openaiKey,
        fmKey: rawFmKey,
        ocrConfig,
        expectedDigits: 7, // Default, can be made configurable
      });

      console.log("[Signed Process] 3-layer extraction complete:", {
        method: extractionResult.method,
        confidence: extractionResult.confidence,
        workOrderNumber: extractionResult.workOrderNumber,
        rationale: extractionResult.rationale,
        candidates: extractionResult.candidates,
      });
      
      // Log snippet URL if available (for visual verification of what was captured)
      if (extractionResult.debug) {
        console.log("[Signed Process] Extraction debug info:", extractionResult.debug);
      }
    } catch (error) {
      console.error("[Signed Process] 3-layer extraction failed:", error);
      // Continue with existing flow if extraction fails
    }

    // Call process layer with normalized PDF
    const result = await processSignedPdf({
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
      // Pass extraction results to processor
      extractionResult: extractionResult ? {
        workOrderNumber: extractionResult.workOrderNumber,
        method: extractionResult.method,
        confidence: extractionResult.confidence,
        rationale: extractionResult.rationale || undefined,
      } : null,
    });

    // Shadow write to DB (non-blocking - don't fail if DB write fails)
    try {
      const { ingestSignedAuthoritative } = await import("@/lib/db/services/ingestSigned");
      const { getWorkspaceIdForUser } = await import("@/lib/db/utils/getWorkspaceId");
      
      // Get workspace ID (DB-native: from cookies or user lookup)
      const workspaceId = await getWorkspaceIdForUser();
      
      if (!workspaceId) {
        console.warn("[Signed Process] No workspace ID found - skipping DB shadow write");
        // Continue without DB write (non-blocking)
      } else {
        await ingestSignedAuthoritative({
          workspaceId,
          pdfBuffer: normalizedPdfBuffer,
          signedPdfUrl: result.signedPdfUrl || null, // Don't pass empty string, pass null
          signedPreviewImageUrl: result.snippetDriveUrl || result.snippetImageUrl || null,
          fmKey: rawFmKey || null,
          extractionResult: extractionResult ? {
            workOrderNumber: extractionResult.workOrderNumber,
            method: extractionResult.method,
            confidence: extractionResult.confidence,
            rationale: extractionResult.rationale || undefined,
            candidates: extractionResult.candidates || undefined,
          } : null,
          workOrderNumber: woNumberOverride || extractionResult?.workOrderNumber || null,
          sourceMetadata: {
            filename: originalFilename,
            source: "UPLOAD",
          },
        });
        console.log("[Signed Process] ✅ Shadow wrote signed document to DB");
      }
    } catch (dbError) {
      // Log but don't fail - DB is shadow write
      console.warn("[Signed Process] ⚠️ Failed to shadow write signed document to DB (non-fatal):", dbError);
    }

    // Log snippet URLs (just URLs, not content)
    if (result.snippetUrl || result.snippetDriveUrl || result.snippetImageUrl) {
      console.log("📸 [Signed Process] Snippet URLs:", {
        snippetImageUrl: result.snippetImageUrl ? (result.snippetImageUrl.startsWith("data:") ? "data:image/png;base64..." : result.snippetImageUrl) : null,
        snippetDriveUrl: result.snippetDriveUrl || null,
        snippetUrl: result.snippetUrl || null,
      });
    }

    // Map unified result to existing response format for compatibility
    // Use standardized fields from processSignedPdfUnified
    const responseData = {
      mode: result.needsReview ? "NEEDS_REVIEW" as const : "UPDATED" as const,
      data: {
        fmKey: rawFmKey,
        woNumber: result.woNumber || result.workOrderNumber, // Use standardized field
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
        snippetUrl: result.snippetUrl || null, // Standardized field - OPEN THIS TO SEE WHAT WAS CAPTURED
        jobExistsInSheet1: false, // Will be determined by processor
        retryAttempted: false,
        alternatePageAttempted: false,
        reason: result.needsReviewReason || null, // Use standardized field
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
        // 3-layer extraction results
        extraction: extractionResult ? {
          workOrderNumber: extractionResult.workOrderNumber,
          method: extractionResult.method,
          confidence: extractionResult.confidence,
          rationale: extractionResult.rationale || null,
          candidates: extractionResult.candidates || null,
        } : null,
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
