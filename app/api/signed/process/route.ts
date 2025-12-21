import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import {
  updateJobWithSignedInfoByWorkOrderNumber,
  writeWorkOrderRecord,
  findWorkOrderRecordByJobId,
  type WorkOrderRecord,
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
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";

export const runtime = "nodejs";

const MAIN_SHEET_NAME =
  process.env.GOOGLE_SHEETS_MAIN_SHEET_NAME || "Sheet1";

const WORK_ORDERS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

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
    const pageOverride = formData.get("page");
    const pageNumber = pageOverride ? parseInt(String(pageOverride), 10) : null;

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
      // Override page number if provided in form data
      if (pageNumber !== null && !isNaN(pageNumber) && pageNumber > 0) {
        templateConfig = {
          ...templateConfig,
          page: pageNumber,
        };
      }
      console.log("[Signed Process] Template config found:", {
        templateId: templateConfig.templateId,
        page: templateConfig.page,
        pageOverride: pageNumber,
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
    let jobExistsInSheet1 = false;

    // Check if job exists in Sheet1 BEFORE attempting to update
    // Work orders can only be signed if they exist in the original job sheet
    if (effectiveWoNumber) {
      const { createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");
      const sheets = createSheetsClient(accessToken);
      
      const mainSheetResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: formatSheetRange(MAIN_SHEET_NAME, "A:Z"),
      });
      
      const mainRows = mainSheetResponse.data.values || [];
      
      if (mainRows.length > 0) {
        const headers = mainRows[0] as string[];
        const headersLower = headers.map((h) => h.toLowerCase().trim());
        const woColIndex = headersLower.indexOf("wo_number");
        
        if (woColIndex >= 0) {
          for (let i = 1; i < mainRows.length; i++) {
            const row = mainRows[i];
            const cellValue = (row?.[woColIndex] || "").trim();
            if (cellValue === effectiveWoNumber.trim()) {
              jobExistsInSheet1 = true;
              console.log(`[Signed Process] Found matching job in Sheet1 for wo_number "${effectiveWoNumber}"`);
              break;
            }
          }
        }
      }

      if (!jobExistsInSheet1) {
        console.log(`[Signed Process] ⚠️ No matching job found in Sheet1 for wo_number "${effectiveWoNumber}" - cannot sign without existing job`);
      }
    }

    // Update main sheet if: valid woNumber, medium/high confidence (>= 0.6), job exists in Sheet1, and successful update
    // IMPORTANT: Only allow signing if job exists in Sheet1 (work is complete if there's a signature, ready for invoice)
    if (effectiveWoNumber && isMediumOrHighConfidence && jobExistsInSheet1) {
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
    } else if (effectiveWoNumber && isMediumOrHighConfidence && !jobExistsInSheet1) {
      console.log(`[Signed Process] ⚠️ Cannot auto-update: job not found in Sheet1 for wo_number "${effectiveWoNumber}"`);
    }

    // Determine mode: UPDATED only if job was successfully updated in Sheet1
    // IMPORTANT: Cannot sign/update if job doesn't exist in Sheet1 (work must exist before it can be signed)
    // Even high confidence requires a match in Sheet1 - signature means work is complete and ready for invoice
    const mode = jobUpdated ? "UPDATED" : "NEEDS_REVIEW";

    // Fallback: append to Needs_Review_Signed if job wasn't updated AND mode is NEEDS_REVIEW
    if (mode === "NEEDS_REVIEW") {
      const reason =
        manualReason ||
        (!effectiveWoNumber
          ? "no_work_order_number"
          : !jobExistsInSheet1
          ? "no_matching_job_row"
          : isMediumOrHighConfidence
          ? "update_failed"
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

    // Update Work_Orders sheet with signed info ONLY if:
    // 1. We have a WO number
    // 2. The job exists in Sheet1 (jobExistsInSheet1)
    // If no match in Sheet1, the signed work order should ONLY go to Needs_Review_Signed sheet
    if (effectiveWoNumber && jobExistsInSheet1) {
      try {
        // Find existing record by searching main sheet for the issuer
        // The jobId format is: normalize(issuer) + ":" + normalize(wo_number)
        // We need the issuer from the main sheet to compute the correct jobId
        const { createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");
        const sheets = createSheetsClient(accessToken);
        
        // Search main sheet by wo_number to find the issuer
        const mainSheetResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: formatSheetRange(MAIN_SHEET_NAME, "A:Z"),
        });
        
        const mainRows = mainSheetResponse.data.values || [];
        let existingIssuer: string | null = null;
        
        if (mainRows.length > 0) {
          const headers = mainRows[0] as string[];
          const headersLower = headers.map((h) => h.toLowerCase().trim());
          const woColIndex = headersLower.indexOf("wo_number");
          const issuerColIndex = headersLower.indexOf("issuer");
          
          if (woColIndex >= 0) {
            for (let i = 1; i < mainRows.length; i++) {
              const row = mainRows[i];
              const cellValue = (row?.[woColIndex] || "").trim();
              if (cellValue === effectiveWoNumber && issuerColIndex >= 0) {
                existingIssuer = (row[issuerColIndex] || "").trim() || null;
                console.log(`[Signed Process] Found existing issuer "${existingIssuer}" for wo_number "${effectiveWoNumber}"`);
                break;
              }
            }
          }
        }
        
        // Use found issuer, or fallback to fmKey if not found (for new records)
        const issuerKey = existingIssuer || fmKey || "unknown";
        const jobId = generateJobId(issuerKey, effectiveWoNumber);
        
        console.log(`[Signed Process] Computed jobId: ${jobId} (issuer: ${issuerKey}, wo_number: ${effectiveWoNumber})`);

        // Look up existing Work_Orders row to merge with
        const existingWorkOrder = await findWorkOrderRecordByJobId(
          accessToken,
          spreadsheetId,
          WORK_ORDERS_SHEET_NAME,
          jobId
        );

        // Build merged WorkOrderRecord that preserves existing data we don't know
        // Always use fmKey from request (not from existing record) to ensure correctness
        const mergedWorkOrder: WorkOrderRecord = {
          jobId,
          fmKey: fmKey, // Always use the correct fmKey from request, not from existing record
          wo_number: effectiveWoNumber,
          status: mode === "UPDATED" ? "SIGNED" : (existingWorkOrder?.status ?? "OPEN"),
          scheduled_date: existingWorkOrder?.scheduled_date ?? null,
          created_at: existingWorkOrder?.created_at ?? nowIso,
          timestamp_extracted: nowIso,
          customer_name: existingWorkOrder?.customer_name ?? null,
          vendor_name: existingWorkOrder?.vendor_name ?? null,
          service_address: existingWorkOrder?.service_address ?? null,
          job_type: existingWorkOrder?.job_type ?? null,
          job_description: existingWorkOrder?.job_description ?? null,
          amount: existingWorkOrder?.amount ?? null,
          currency: existingWorkOrder?.currency ?? null,
          notes: existingWorkOrder?.notes ?? null,
          priority: existingWorkOrder?.priority ?? null,
          calendar_event_link: existingWorkOrder?.calendar_event_link ?? null,
          work_order_pdf_link: existingWorkOrder?.work_order_pdf_link ?? null,
          signed_pdf_url:
            signedPdfUrl ??
            existingWorkOrder?.signed_pdf_url ??
            null,
          signed_preview_image_url:
            snippetDriveUrl ??
            existingWorkOrder?.signed_preview_image_url ??
            null,
          source: existingWorkOrder?.source ?? "signed_upload",
          last_updated_at: nowIso,
        };

        console.log(`[Signed Process] Writing to Work_Orders sheet:`, {
          jobId,
          fmKey,
          woNumber: effectiveWoNumber,
          hadExisting: !!existingWorkOrder,
          spreadsheetId: `${spreadsheetId.substring(0, 10)}...`,
          sheetName: WORK_ORDERS_SHEET_NAME,
          envSheetName: process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME,
          mergedWorkOrderFmKey: mergedWorkOrder.fmKey,
        });

        await writeWorkOrderRecord(
          accessToken,
          spreadsheetId,
          WORK_ORDERS_SHEET_NAME,
          mergedWorkOrder
        );
        
        // Verify the write by reading back the record
        const verifyRecord = await findWorkOrderRecordByJobId(
          accessToken,
          spreadsheetId,
          WORK_ORDERS_SHEET_NAME,
          jobId
        );
        
        console.log(`[Signed Process] ✅ Work_Orders sheet updated and verified:`, {
          jobId,
          fmKey: mergedWorkOrder.fmKey,
          woNumber: mergedWorkOrder.wo_number,
          status: mergedWorkOrder.status,
          hadExisting: !!existingWorkOrder,
          verified: !!verifyRecord,
          verifiedFmKey: verifyRecord?.fmKey,
          verifiedWoNumber: verifyRecord?.wo_number,
          verifiedStatus: verifyRecord?.status,
        });
        
        if (verifyRecord && verifyRecord.fmKey !== mergedWorkOrder.fmKey) {
          console.warn(`[Signed Process] ⚠️ WARNING: fmKey mismatch! Expected "${mergedWorkOrder.fmKey}", but sheet has "${verifyRecord.fmKey}"`);
        }
      } catch (woError) {
        // Log but don't fail the request - but log detailed error info
        console.error(`[Signed Process] Error writing to Work_Orders sheet:`, {
          error: woError,
          message: woError instanceof Error ? woError.message : String(woError),
          stack: woError instanceof Error ? woError.stack : undefined,
          jobId: effectiveWoNumber ? generateJobId(fmKey || "unknown", effectiveWoNumber) : "unknown",
          spreadsheetId: `${spreadsheetId.substring(0, 10)}...`,
          sheetName: WORK_ORDERS_SHEET_NAME,
        });
      }
    } else if (effectiveWoNumber && !jobExistsInSheet1) {
      console.log(`[Signed Process] Skipping Work_Orders sheet - no matching job in Sheet1 for wo_number "${effectiveWoNumber}". Record goes to Needs_Review_Signed sheet only.`);
    }

    return NextResponse.json(
      {
        mode,
        data: {
          fmKey,
          woNumber: effectiveWoNumber || null,
          confidenceLabel,
          confidenceRaw,
          signedPdfUrl,
          // Always include the original base64 snippet URL as fallback
          snippetImageUrl: snippetImageUrl ?? null,
          // Use Drive URL if available, otherwise fall back to base64
          snippetDriveUrl: snippetDriveUrl ?? snippetImageUrl ?? null,
          jobExistsInSheet1: jobExistsInSheet1,
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

