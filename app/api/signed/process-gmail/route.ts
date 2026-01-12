/**
 * API route to process a single Gmail attachment through the signed PDF pipeline.
 * 
 * POST /api/signed/process-gmail
 * Body: { messageId: string, attachmentId: string, fmKey?: string }
 * 
 * Downloads the PDF attachment from Gmail, then processes it through the signed pipeline
 * (digital → OCR → AI extraction with confidence scoring).
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { processSignedPdfUnified } from "@/lib/signed/processor";
import { normalizePdfBuffer } from "@/lib/pdf/normalizePdf";
import { extractWorkOrderNumber } from "@/lib/signed/extractWorkOrderNumber";
import { getTemplateConfigForFmKey } from "@/lib/workOrders/templateConfig";
import { createGmailClient } from "@/lib/google/gmail";
import { extractPdfAttachments } from "@/lib/google/gmailExtract";

export const runtime = "nodejs";

export async function POST(req: Request) {
  console.log("[Signed Process Gmail] POST /api/signed/process-gmail called");
  try {
    const user = await getCurrentUser();
    if (!user) {
      console.log("[Signed Process Gmail] No user found");
      return new Response("Unauthorized", { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
      console.log("[Signed Process Gmail] No Google access token");
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

    const body = await req.json();
    const { messageId, attachmentId, fmKey, filename } = body;

    if (!messageId || !attachmentId) {
      return NextResponse.json(
        { error: "messageId and attachmentId are required." },
        { status: 400 }
      );
    }

    if (!fmKey || !fmKey.trim()) {
      return NextResponse.json(
        { error: "fmKey is required to process signed work orders." },
        { status: 400 }
      );
    }

    const rawFmKey = fmKey.trim();

    // Get AI settings from headers (for 3-layer extraction)
    const aiEnabled = req.headers.get("x-ai-enabled") === "true";
    const openaiKey = req.headers.get("x-openai-key")?.trim() || null;

    // Download PDF attachment from Gmail
    const gmail = createGmailClient(accessToken);
    
    // Get full message to find the attachment
    const full = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const payload = full.data.payload;
    const pdfAttachments = extractPdfAttachments(payload);
    
    console.log("[Signed Process Gmail] Extracted PDF attachments:", {
      count: pdfAttachments.length,
      attachmentIds: pdfAttachments.map(att => att.attachmentId),
      filenames: pdfAttachments.map(att => att.filename),
      lookingForAttachmentId: attachmentId,
      lookingForFilename: filename,
    });
    
    // Find the specific attachment by attachmentId first (preferred)
    let targetAttachment = pdfAttachments.find((att) => att.attachmentId === attachmentId);
    
    // If not found by attachmentId, try to match by filename from the request body
    // This handles cases where Gmail returns different attachment IDs between fetches
    if (!targetAttachment && filename) {
      console.log("[Signed Process Gmail] Attachment ID not found, trying to match by filename:", filename);
      targetAttachment = pdfAttachments.find((att) => 
        att.filename === filename || 
        att.filename.toLowerCase() === filename.toLowerCase()
      );
    }
    
    if (!targetAttachment) {
      console.error("[Signed Process Gmail] Attachment not found:", {
        messageId,
        attachmentId,
        requestedFilename: filename,
        availableAttachments: pdfAttachments.map(att => ({
          attachmentId: att.attachmentId,
          filename: att.filename,
        })),
      });
      return NextResponse.json(
        { error: `Attachment not found in message ${messageId}. Requested: ${attachmentId || "N/A"} / ${filename || "N/A"}. Available: ${pdfAttachments.map(a => `${a.filename} (${a.attachmentId})`).join(", ")}` },
        { status: 404 }
      );
    }
    
    console.log("[Signed Process Gmail] Found target attachment:", {
      attachmentId: targetAttachment.attachmentId,
      filename: targetAttachment.filename,
      matchedBy: targetAttachment.attachmentId === attachmentId ? "attachmentId" : "filename",
    });
    
    console.log("[Signed Process Gmail] Found target attachment:", {
      attachmentId: targetAttachment.attachmentId,
      filename: targetAttachment.filename,
    });

    // Download the attachment
    const attachRes = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    const data = attachRes.data.data;
    if (!data) {
      return NextResponse.json(
        { error: "Failed to download attachment data." },
        { status: 500 }
      );
    }

    // Gmail returns URL-safe base64, convert to standard base64
    const base64Data = data.replace(/-/g, "+").replace(/_/g, "/");
    const pdfBuffer = Buffer.from(base64Data, "base64");
    const originalFilename = targetAttachment.filename || "signed-work-order.pdf";

    // Normalize PDF before processing
    console.log("🔧 [NORMALIZATION] Starting PDF normalization before signed processing:", {
      filename: originalFilename,
      originalSize: pdfBuffer.length,
      timestamp: new Date().toISOString(),
    });
    
    const normalizedPdfBuffer = await normalizePdfBuffer(pdfBuffer);
    
    if (normalizedPdfBuffer !== pdfBuffer) {
      console.log("✅ [NORMALIZATION] PDF NORMALIZED SUCCESSFULLY before signed processing");
    } else {
      console.log("ℹ️ [NORMALIZATION] PDF did not require normalization");
    }

    // Step: Run 3-layer extraction flow (Digital → OCR → AI Rescue)
    let extractionResult = null;
    try {
      // Try to get template config for OCR coordinates (optional)
      let ocrConfig: {
        page: number;
        xPt: number;
        yPt: number;
        wPt: number;
        hPt: number;
        pageWidthPt: number;
        pageHeightPt: number;
        dpi: number;
      } | undefined = undefined;
      
      try {
        const templateConfig = await getTemplateConfigForFmKey(rawFmKey);
        if (
          templateConfig.xPt !== undefined &&
          templateConfig.yPt !== undefined &&
          templateConfig.wPt !== undefined &&
          templateConfig.hPt !== undefined &&
          templateConfig.pageWidthPt !== undefined &&
          templateConfig.pageHeightPt !== undefined
        ) {
          ocrConfig = {
            page: 1,
            xPt: templateConfig.xPt,
            yPt: templateConfig.yPt,
            wPt: templateConfig.wPt,
            hPt: templateConfig.hPt,
            pageWidthPt: templateConfig.pageWidthPt,
            pageHeightPt: templateConfig.pageHeightPt,
            dpi: 200,
          };
        }
      } catch (error) {
        // Template not found - OCR config will be undefined
        console.log("[Signed Process Gmail] Template config not available for OCR, will skip OCR layer:", error);
      }

      extractionResult = await extractWorkOrderNumber({
        pdfBuffer: normalizedPdfBuffer,
        aiEnabled,
        openaiKey,
        fmKey: rawFmKey,
        ocrConfig,
        expectedDigits: 7,
      });

      console.log("[Signed Process Gmail] 3-layer extraction complete:", {
        method: extractionResult.method,
        confidence: extractionResult.confidence,
        workOrderNumber: extractionResult.workOrderNumber,
        rationale: extractionResult.rationale,
      });
    } catch (error) {
      console.error("[Signed Process Gmail] 3-layer extraction failed:", error);
      // Continue with existing flow if extraction fails
    }

    // Call process layer with normalized PDF
    const result = await processSignedPdfUnified({
      pdfBytes: normalizedPdfBuffer,
      originalFilename,
      page: 1,
      fmKey: rawFmKey,
      spreadsheetId,
      accessToken,
      source: "GMAIL",
      sourceMeta: {
        gmailMessageId: messageId,
        gmailAttachmentId: attachmentId,
        gmailFrom: full.data.payload?.headers?.find((h: any) => h.name?.toLowerCase() === "from")?.value || null,
        gmailSubject: full.data.payload?.headers?.find((h: any) => h.name?.toLowerCase() === "subject")?.value || null,
        gmailDate: full.data.payload?.headers?.find((h: any) => h.name?.toLowerCase() === "date")?.value || null,
      },
      dpi: 200,
      // Pass extraction results to processor
      extractionResult: extractionResult ? {
        workOrderNumber: extractionResult.workOrderNumber,
        method: extractionResult.method,
        confidence: extractionResult.confidence,
        rationale: extractionResult.rationale || undefined,
      } : null,
    });

    // Map unified result to existing response format for compatibility
    const isAlreadyProcessed = result.alreadyProcessed === true;
    const responseData = {
      mode: isAlreadyProcessed ? "ALREADY_PROCESSED" as const : (result.needsReview ? "NEEDS_REVIEW" as const : "UPDATED" as const),
      data: {
        fmKey: rawFmKey,
        woNumber: result.woNumber || result.workOrderNumber,
        ocrConfidenceLabel: result.confidenceLabel,
        ocrConfidenceRaw: result.confidence,
        confidenceLabel: result.confidenceLabel,
        confidenceRaw: result.confidence,
        automationStatus: isAlreadyProcessed ? "BLOCKED" as const : (result.needsReview ? "REVIEW" as const : "APPLIED" as const),
        automationBlocked: isAlreadyProcessed,
        automationBlockReason: isAlreadyProcessed ? "Work order already processed (already signed)" : null,
        signedPdfUrl: result.signedPdfUrl || null,
        snippetImageUrl: result.snippetImageUrl || null,
        snippetDriveUrl: result.snippetDriveUrl || null,
        snippetUrl: result.snippetUrl || null,
        jobExistsInSheet1: false,
        retryAttempted: false,
        alternatePageAttempted: false,
        reason: result.needsReviewReason || null,
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
    console.error("Error in POST /api/signed/process-gmail", error);
    const message =
      error instanceof Error ? error.message : "Failed to process signed work order from Gmail";
    return NextResponse.json(
      {
        error: "Failed to process signed work order from Gmail.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
