import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import {
  updateJobWithSignedInfoByWorkOrderNumber,
} from "@/lib/google/sheets";
import {
  appendSignedNeedsReviewRow,
} from "@/lib/workOrders/signedSheets";
import {
  callSignedOcrService,
} from "@/lib/workOrders/signedOcr";
import {
  getTemplateConfigForFmKey,
} from "@/lib/workOrders/templateConfig";
import {
  uploadPdfToDrive,
  getOrCreateFolder,
} from "@/lib/google/drive";
import { uploadSnippetImageToDrive } from "@/lib/drive-snippets";

export const runtime = "nodejs";

const MAIN_SHEET_NAME =
  process.env.GOOGLE_SHEETS_MAIN_SHEET_NAME || "Sheet1";

const SIGNED_DRIVE_FOLDER_NAME =
  process.env.GOOGLE_DRIVE_SIGNED_FOLDER_NAME || "Signed Work Orders";

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

    // Resolve spreadsheetId using the same logic as existing Pro routes
    const cookieStore = await cookies();
    const cookieSpreadsheetId =
      cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      const session = await auth();
      const sessionSpreadsheetId = session
        ? (session as any).googleSheetsSpreadsheetId
        : null;
      spreadsheetId = await getUserSpreadsheetId(
        user.userId,
        sessionSpreadsheetId
      );
    }

    if (!spreadsheetId) {
      console.log("[Signed Process] No spreadsheet ID configured");
      return NextResponse.json(
        { error: "No Google Sheets spreadsheet configured." },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      console.log("[Signed Process] No file uploaded");
      return NextResponse.json(
        { error: "No signed PDF uploaded." },
        { status: 400 }
      );
    }

    const fmKey = (formData.get("fmKey") as string | null)?.trim() || "";
    if (!fmKey) {
      console.log("[Signed Process] No fmKey provided");
      return NextResponse.json(
        { error: "fmKey is required to process signed work orders." },
        { status: 400 }
      );
    }

    console.log("[Signed Process] Starting processing:", {
      fmKey,
      filename: file.name,
      fileSize: file.size,
    });

    const woNumberOverride =
      (formData.get("woNumber") as string | null) || null;
    const manualReason = (formData.get("reason") as string | null) || null;

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);
    const originalFilename = file.name || "signed-work-order.pdf";

    // Upload signed PDF to Drive into a dedicated folder (reuse existing helpers)
    const signedFolderId = await getOrCreateFolder(
      accessToken,
      SIGNED_DRIVE_FOLDER_NAME
    );

    const uploaded = await uploadPdfToDrive(
      accessToken,
      pdfBuffer,
      originalFilename,
      signedFolderId
    );

    const signedPdfUrl = uploaded.webViewLink || uploaded.webContentLink;

    // Resolve template config based on fmKey (temporary stub uses HARDCODED_TEMPLATES)
    let templateConfig;
    try {
      templateConfig = await getTemplateConfigForFmKey(fmKey);
      console.log("[Signed Process] Template config found:", {
        templateId: templateConfig.templateId,
        page: templateConfig.page,
      });
    } catch (error) {
      console.error("[Signed Process] Template config error:", error);
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Template config not found for fmKey",
          fmKey,
        },
        { status: 400 }
      );
    }

    // Call OCR microservice
    const ocrResult = await callSignedOcrService(
      pdfBuffer,
      originalFilename,
      {
        templateId: templateConfig.templateId,
        page: templateConfig.page,
        region: templateConfig.region,
        dpi: templateConfig.dpi,
      }
    );

    // Normalize confidence & label with explicit thresholds
    // High (>= 0.9): Clear match with image - auto-update
    // Medium (>= 0.6): Somewhat reliable - auto-update
    // Low (< 0.6): Needs manual review
    const confidenceRaw = ocrResult.confidenceRaw ?? 0;
    let confidenceLabel: "low" | "medium" | "high";

    if (confidenceRaw >= 0.9) {
      confidenceLabel = "high";
    } else if (confidenceRaw >= 0.6) {
      confidenceLabel = "medium";
    } else {
      confidenceLabel = "low";
    }

    const woNumber = ocrResult.woNumber ?? null;
    const rawText = ocrResult.rawText || "";
    const snippetImageUrl = ocrResult.snippetImageUrl;

    console.log("[Signed Process] OCR result:", {
      fmKey,
      woNumber,
      rawTextLength: rawText?.length || 0,
      rawTextPreview: rawText?.substring(0, 100) || "",
      confidenceLabel,
      confidenceRaw,
    });

    // Upload snippet to Drive if present (convert base64 to PNG buffer)
    let snippetDriveUrl: string | null = null;
    if (ocrResult.snippetImageUrl) {
      try {
        const [prefix, base64Part] = ocrResult.snippetImageUrl.split(",", 2);
        if (base64Part) {
          const pngBuffer = Buffer.from(base64Part, "base64");

          // Generate filename: snippet-{fmKey}-{woNumber}-{timestamp}.png
          const fileNameParts = [
            "snippet",
            fmKey || "unknown",
            ocrResult.woNumber || "no-wo",
            Date.now().toString(),
          ];
          const fileName = fileNameParts.join("-") + ".png";

          snippetDriveUrl = await uploadSnippetImageToDrive({
            accessToken,
            fileName,
            pngBuffer,
          });
        }
      } catch (err) {
        console.error("[Drive] Failed to upload snippet to Drive:", err);
      }
    }

    const effectiveWoNumber = (woNumberOverride || woNumber || "").trim();
    const nowIso = new Date().toISOString();

    // Make the "job matched" decision explicit
    // Trust OCR more - allow both high and medium confidence to auto-update
    const isHighConfidence = confidenceLabel === "high";
    const isMediumOrHighConfidence = confidenceLabel === "high" || confidenceLabel === "medium";
    let jobUpdated = false;

    // Update main sheet if: valid woNumber, medium/high confidence (>= 0.3), and successful update
    if (effectiveWoNumber && isMediumOrHighConfidence) {
      jobUpdated = await updateJobWithSignedInfoByWorkOrderNumber(
        accessToken,
        spreadsheetId,
        MAIN_SHEET_NAME,
        effectiveWoNumber,
        {
          signedPdfUrl,
          signedPreviewImageUrl: snippetDriveUrl ?? null,
          confidence: confidenceLabel,
          signedAt: nowIso,
          statusOverride: "SIGNED",
          fmKey: fmKey, // Ensure fmKey is set correctly (e.g., "23rd_group" not "superclean")
        }
      );
    }

    // Fallback: append to Needs_Review_Signed if job wasn't updated
    if (!jobUpdated) {
      const reason =
        manualReason ||
        (!effectiveWoNumber
          ? "no_work_order_number"
          : isMediumOrHighConfidence
          ? "no_matching_job_row"
          : "low_confidence");

      await appendSignedNeedsReviewRow(accessToken, spreadsheetId, {
        fmKey,
        signed_pdf_url: signedPdfUrl,
        preview_image_url: snippetDriveUrl ?? null,
        raw_text: rawText,
        confidence: confidenceLabel,
        reason,
        manual_work_order_number: effectiveWoNumber || null,
        resolved: "FALSE",
        resolved_at: null,
      });
    }

    // Set mode based on jobUpdated
    const mode = jobUpdated ? "UPDATED" : "NEEDS_REVIEW";

    return NextResponse.json(
      {
        mode,
        data: {
          fmKey,
          woNumber: effectiveWoNumber || null,
          confidenceLabel,
          confidenceRaw,
          signedPdfUrl,
          snippetImageUrl: snippetImageUrl,
          snippetDriveUrl: snippetDriveUrl ?? null,
        },
      },
      { status: 200 }
    );
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

