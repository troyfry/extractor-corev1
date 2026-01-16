import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { logLegacyUpdateWarning } from "@/lib/readAdapter/guardrails";
import {
  updateJobWithSignedInfoByWorkOrderNumber,
  writeWorkOrderRecord,
  getSheetHeadersCached,
  findRowIndexByColumnValue,
  findWorkOrderRecordByJobId,
  type WorkOrderRecord,
} from "@/lib/google/sheets";
import {
  findSignedNeedsReviewRowById,
  markSignedNeedsReviewResolved,
  updateSignedNeedsReviewUnresolved,
} from "@/lib/workOrders/signedSheets";
import { NEEDS_REVIEW_REASONS } from "@/lib/workOrders/reasons";
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";
import { getNeedsReviewUx } from "@/lib/workOrders/reviewReasons";

export const runtime = "nodejs";

const MAIN_SHEET_NAME =
  process.env.GOOGLE_SHEETS_MAIN_SHEET_NAME || "Sheet1";

const WORK_ORDERS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      console.log("[Signed Resolve] No user found");
      return new Response("Unauthorized", { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
      console.log("[Signed Resolve] No Google access token");
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

    // Parse request body
    const body = await req.json();
    const { reviewRowId, fmKey, woNumber, reasonNote } = body as {
      reviewRowId: string;
      fmKey: string;
      woNumber: string;
      reasonNote?: string;
    };

    if (!reviewRowId || !fmKey || !woNumber) {
      return NextResponse.json(
        { error: "Missing required fields: reviewRowId, fmKey, woNumber" },
        { status: 400 }
      );
    }

    // Check if legacy writes should be blocked
    const { shouldBlockLegacyWrites } = await import("@/lib/readAdapter/guardrails");
    const blockWrites = await shouldBlockLegacyWrites();
    
    if (blockWrites) {
      // In DB Native Mode, legacy writes are blocked
      return NextResponse.json(
        {
          error: "Legacy write endpoint disabled. Please use DB endpoints.",
          code: "LEGACY_DISABLED",
        },
        { status: 410 } // 410 Gone - indicates resource is no longer available
      );
    }
    
    // Log warning if DB is primary (guardrail)
    await logLegacyUpdateWarning("/api/signed/resolve", {
      reviewRowId,
      fmKey,
      woNumber,
    });

    // Look up the Needs_Review_Signed row by review_id
    const reviewRow = await findSignedNeedsReviewRowById(
      accessToken,
      spreadsheetId,
      reviewRowId
    );

    if (!reviewRow) {
      return NextResponse.json(
        { error: `Review row not found: ${reviewRowId}` },
        { status: 404 }
      );
    }

    // Get review sheet headers to extract data from review row
    const reviewHeaderMeta = await getSheetHeadersCached(
      accessToken,
      spreadsheetId,
      "Needs_Review_Signed"
    );
    const signedPdfUrlIdx = reviewHeaderMeta.colIndexByLower["signed_pdf_url"];
    const previewImageUrlIdx = reviewHeaderMeta.colIndexByLower["preview_image_url"];

    const signedPdfUrl =
      signedPdfUrlIdx >= 0 && reviewRow.rowData[signedPdfUrlIdx]
        ? String(reviewRow.rowData[signedPdfUrlIdx]).trim()
        : null;
    const previewImageUrl =
      previewImageUrlIdx >= 0 && reviewRow.rowData[previewImageUrlIdx]
        ? String(reviewRow.rowData[previewImageUrlIdx]).trim()
        : null;

    // Check whether woNumber exists in Sheet1 using optimized column-only reads
    const headerMeta = await getSheetHeadersCached(
      accessToken,
      spreadsheetId,
      MAIN_SHEET_NAME
    );
    const woNumberLetter = headerMeta.colLetterByLower["wo_number"];

    let jobExistsInSheet1 = false;
    let existingIssuer: string | null = null;

    if (woNumberLetter) {
      const rowIndex = await findRowIndexByColumnValue(
        accessToken,
        spreadsheetId,
        MAIN_SHEET_NAME,
        woNumberLetter,
        woNumber
      );

      if (rowIndex !== -1) {
        jobExistsInSheet1 = true;

        // Read the row to get issuer
        const { createSheetsClient, formatSheetRange } = await import(
          "@/lib/google/sheets"
        );
        const sheets = createSheetsClient(accessToken);
        const rowResponse = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: formatSheetRange(MAIN_SHEET_NAME, `${rowIndex}:${rowIndex}`),
        });

        const rowData = (rowResponse.data.values?.[0] || []) as string[];
        const issuerIdx = headerMeta.colIndexByLower["issuer"];
        if (issuerIdx >= 0 && rowData[issuerIdx]) {
          existingIssuer = String(rowData[issuerIdx]).trim();
        }
      }
    }

    if (jobExistsInSheet1) {
      // Update Sheet1 signed fields using updateJobWithSignedInfoByWorkOrderNumber with manuallyOverridden:true
      await updateJobWithSignedInfoByWorkOrderNumber(
        accessToken,
        spreadsheetId,
        MAIN_SHEET_NAME,
        woNumber,
        {
          signedPdfUrl: signedPdfUrl || "",
          signedPreviewImageUrl: previewImageUrl,
          confidence: "high" as const, // Manual override is high confidence
          signedAt: new Date().toISOString(),
          manuallyOverridden: true,
        }
      );

      // Update Work_Orders using writeWorkOrderRecord merge flow
      // Generate jobId from issuer + woNumber
      const issuer = existingIssuer || fmKey; // Fallback to fmKey if issuer not found
      const jobId = generateJobId(issuer, woNumber);

      // Fetch existing work order to merge with
      const existingWorkOrder = await findWorkOrderRecordByJobId(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        jobId
      );

      const nowIso = new Date().toISOString();

      // Build merged WorkOrderRecord that preserves existing data
      const mergedWorkOrder: WorkOrderRecord = {
        jobId,
        fmKey: fmKey,
        wo_number: woNumber,
        status: "SIGNED",
        scheduled_date: existingWorkOrder?.scheduled_date ?? null,
        created_at: existingWorkOrder?.created_at ?? nowIso,
        timestamp_extracted: existingWorkOrder?.timestamp_extracted ?? nowIso,
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
        signed_pdf_url: signedPdfUrl || existingWorkOrder?.signed_pdf_url || null,
        signed_preview_image_url: previewImageUrl || existingWorkOrder?.signed_preview_image_url || null,
        signed_at: nowIso,
        source: existingWorkOrder?.source ?? "signed_upload",
        last_updated_at: nowIso,
      };

      await writeWorkOrderRecord(accessToken, spreadsheetId, WORK_ORDERS_SHEET_NAME, mergedWorkOrder);

      // Mark Needs_Review_Signed row resolved TRUE, resolved_at now, manual_work_order_number set, reason_note stored
      await markSignedNeedsReviewResolved(
        accessToken,
        spreadsheetId,
        reviewRowId,
        woNumber,
        reasonNote
      );

      // Get UX mapping for UPDATED mode (success)
      const ux = getNeedsReviewUx("MANUALLY_RESOLVED", fmKey);
      
      // Rehydrate cookies if workspace was loaded from Users Sheet
      const response = NextResponse.json({
        mode: "UPDATED",
        data: {
          woNumber,
          jobExistsInSheet1: true,
          fixHref: ux.href || null,
          fixAction: ux.actionLabel || null,
          reasonTitle: ux.title,
          reasonMessage: ux.message,
          tone: ux.tone,
        },
      });
      if (workspaceResult.source === "users_sheet") {
        rehydrateWorkspaceCookies(response, workspaceResult.workspace);
      }
      return response;
    } else {
      // Update Needs_Review_Signed row with manual_work_order_number, reason="NO_MATCHING_JOB_ROW", resolved remains FALSE, reason_note stored
      await updateSignedNeedsReviewUnresolved(
        accessToken,
        spreadsheetId,
        reviewRowId,
        woNumber,
        NEEDS_REVIEW_REASONS.NO_MATCHING_JOB_ROW,
        reasonNote
      );

      // Get UX mapping for the reason
      const ux = getNeedsReviewUx(NEEDS_REVIEW_REASONS.NO_MATCHING_JOB_ROW, fmKey);
      
      // Rehydrate cookies if workspace was loaded from Users Sheet
      const response = NextResponse.json({
        mode: "NEEDS_REVIEW",
        data: {
          reason: NEEDS_REVIEW_REASONS.NO_MATCHING_JOB_ROW,
          jobExistsInSheet1: false,
          fixHref: ux.href || null,
          fixAction: ux.actionLabel || null,
          reasonTitle: ux.title,
          reasonMessage: ux.message,
          tone: ux.tone,
        },
      });
      if (workspaceResult.source === "users_sheet") {
        rehydrateWorkspaceCookies(response, workspaceResult.workspace);
      }
      return response;
    }
  } catch (error) {
    console.error("Error in POST /api/signed/resolve", error);
    const message =
      error instanceof Error ? error.message : "Failed to resolve signed work order";
    return NextResponse.json(
      {
        error: "Failed to resolve signed work order.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}

