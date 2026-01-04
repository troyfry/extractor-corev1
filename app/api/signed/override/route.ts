import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import {
  updateJobWithSignedInfoByWorkOrderNumber,
  writeWorkOrderRecord,
  findWorkOrderRecordByJobId,
  type WorkOrderRecord,
  REQUIRED_COLUMNS,
} from "@/lib/google/sheets";
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";
import { getColumnRange } from "@/lib/google/sheetsCache";
import { SIGNED_NEEDS_REVIEW_COLUMNS } from "@/lib/workOrders/signedSheets";

export const runtime = "nodejs";

const MAIN_SHEET_NAME =
  process.env.GOOGLE_SHEETS_MAIN_SHEET_NAME || "Sheet1";

const WORK_ORDERS_SHEET_NAME =
  process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

/**
 * POST /api/signed/override
 * 
 * Manually override a "needs-review" signed work order to "updated" status.
 * This requires:
 * 1. A valid work order number
 * 2. A matching job in Sheet1 (main sheet)
 * 3. Signed PDF URL and snippet image URL from the original processing
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
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
    const {
      woNumber,
      fmKey,
      signedPdfUrl,
      signedPreviewImageUrl,
    }: {
      woNumber: string;
      fmKey: string;
      signedPdfUrl: string;
      signedPreviewImageUrl?: string | null;
    } = body;

    if (!woNumber || !fmKey || !signedPdfUrl) {
      return NextResponse.json(
        {
          error: "Missing required fields: woNumber, fmKey, and signedPdfUrl are required.",
        },
        { status: 400 }
      );
    }

    console.log("[Signed Override] Manual override requested:", {
      woNumber,
      fmKey,
      signedPdfUrl: signedPdfUrl.substring(0, 50) + "...",
    });

    // First, check if there's a matching job in Sheet1
    const { createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");
    const sheets = createSheetsClient(accessToken);
    
    const mainSheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(MAIN_SHEET_NAME, getColumnRange(REQUIRED_COLUMNS.length)),
    });
    
    const mainRows = mainSheetResponse.data.values || [];
    let foundJob = false;
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
          if (cellValue === woNumber.trim()) {
            foundJob = true;
            if (issuerColIndex >= 0) {
              existingIssuer = (row[issuerColIndex] || "").trim() || null;
            }
            console.log(`[Signed Override] Found matching job in Sheet1 with issuer: "${existingIssuer}"`);
            break;
          }
        }
      }
    }

    if (!foundJob) {
      return NextResponse.json(
        {
          error: `No matching job found in Sheet1 for work order number "${woNumber}". Cannot override - work order must exist in the original job sheet.`,
        },
        { status: 404 }
      );
    }

    // Update the job in Sheet1 with signed info
    const nowIso = new Date().toISOString();
    const jobUpdated = await updateJobWithSignedInfoByWorkOrderNumber(
      accessToken,
      spreadsheetId,
      MAIN_SHEET_NAME,
      woNumber.trim(),
      {
        signedPdfUrl,
        signedPreviewImageUrl: signedPreviewImageUrl ?? null,
        confidence: "high", // Manual override is treated as high confidence
        signedAt: nowIso,
        statusOverride: "SIGNED",
        fmKey: fmKey,
        manuallyOverridden: true, // Add this flag
      }
    );

    if (!jobUpdated) {
      return NextResponse.json(
        {
          error: "Failed to update job in Sheet1. The work order number may not exist.",
        },
        { status: 500 }
      );
    }

    // Mark Needs_Review_Signed records as resolved
    try {
      const { createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");
      const sheets = createSheetsClient(accessToken);
      
      // Get all rows from Needs_Review_Signed sheet
      const needsReviewResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: formatSheetRange("Needs_Review_Signed", getColumnRange(SIGNED_NEEDS_REVIEW_COLUMNS.length)),
      });
      
      const needsReviewRows = needsReviewResponse.data.values || [];
      if (needsReviewRows.length > 0) {
        const headers = needsReviewRows[0] as string[];
        const headersLower = headers.map((h) => h.toLowerCase().trim());
        const woColIndex = headersLower.indexOf("manual_work_order_number");
        const resolvedColIndex = headersLower.indexOf("resolved");
        const resolvedAtColIndex = headersLower.indexOf("resolved_at");
        
        if (woColIndex >= 0 && resolvedColIndex >= 0) {
          for (let i = 1; i < needsReviewRows.length; i++) {
            const row = needsReviewRows[i];
            const rowWoNumber = (row?.[woColIndex] || "").trim();
            
            if (rowWoNumber === woNumber.trim()) {
              // Update this row to mark as resolved
              const rowData = [...row];
              rowData[resolvedColIndex] = "TRUE";
              if (resolvedAtColIndex >= 0) {
                rowData[resolvedAtColIndex] = nowIso;
              }
              
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: formatSheetRange("Needs_Review_Signed", `${i + 1}:${i + 1}`),
                valueInputOption: "RAW",
                requestBody: {
                  values: [rowData],
                },
              });
              
              console.log(`[Signed Override] Marked Needs_Review_Signed record as resolved for WO ${woNumber}`);
              break;
            }
          }
        }
      }
    } catch (resolveError) {
      console.error(`[Signed Override] Error marking Needs_Review_Signed as resolved:`, resolveError);
      // Don't fail the request if this fails
    }

    // Update Work_Orders sheet
    try {
      const issuerKey = existingIssuer || fmKey || "unknown";
      const jobId = generateJobId(issuerKey, woNumber.trim());
      
      console.log(`[Signed Override] Updating Work_Orders sheet with jobId: ${jobId}`);

      const existingWorkOrder = await findWorkOrderRecordByJobId(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        jobId
      );

      const mergedWorkOrder: WorkOrderRecord = {
        jobId,
        fmKey: fmKey,
        wo_number: woNumber.trim(),
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
        signed_pdf_url: signedPdfUrl,
        signed_preview_image_url: signedPreviewImageUrl ?? null,
        signed_at: nowIso, // Mark as signed when override is applied
        source: existingWorkOrder?.source ?? "signed_upload",
        last_updated_at: nowIso,
        file_hash: existingWorkOrder?.file_hash ?? null, // Preserve existing hash if available
      };

      await writeWorkOrderRecord(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        mergedWorkOrder
      );

      console.log(`[Signed Override] ✅ Successfully overridden and updated work order:`, {
        jobId,
        woNumber,
        status: "SIGNED",
      });
    } catch (woError) {
      console.error(`[Signed Override] Error updating Work_Orders sheet:`, woError);
      // Don't fail the request if Work_Orders update fails, but log it
    }

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json(
      {
        success: true,
        mode: "UPDATED",
        message: `Work order ${woNumber} has been manually updated to SIGNED status.`,
      },
      { status: 200 }
    );
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    return response;
  } catch (error) {
    console.error("Error in POST /api/signed/override", error);
    const message =
      error instanceof Error ? error.message : "Failed to override signed work order";
    return NextResponse.json(
      {
        error: "Failed to override signed work order.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}

