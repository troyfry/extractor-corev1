/**
 * API routes for work orders.
 * 
 * POST /api/work-orders
 *   Body: { workOrders: WorkOrderInput[] }
 *   Response: { workOrders: WorkOrder[] }
 *   Note: userId is automatically attached from session
 * 
 * GET /api/work-orders
 *   Response: { workOrders: WorkOrder[] }
 *   Note: Returns only work orders for the authenticated user
 * 
 * DELETE /api/work-orders
 *   Response: { success: true }
 *   Note: Deletes only work orders for the authenticated user
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import type { WorkOrderInput } from "@/lib/workOrders/types";
import type { ParsedWorkOrder } from "@/lib/workOrders/parsedTypes";

/**
 * Validate that a work order input has all required fields.
 */
function validateWorkOrderInput(input: unknown): input is WorkOrderInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const wo = input as Record<string, unknown>;

  // Only workOrderNumber is required
  return typeof wo.workOrderNumber === "string";
}

/**
 * POST /api/work-orders
 * Create/save multiple work orders.
 * Automatically attaches userId from session (optional for free version).
 */
export async function POST(req: Request) {
  try {
    // Require authentication for Pro tier
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = user.userId;

    const body = await req.json();

    // Validate request body
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.workOrders)) {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    // Validate each work order
    for (const wo of body.workOrders) {
      if (!validateWorkOrderInput(wo)) {
        return NextResponse.json(
          { error: "Invalid payload" },
          { status: 400 }
        );
      }
    }

    // Convert WorkOrderInput[] to ParsedWorkOrder[] for Sheets ingestion
    // (No DB persistence - Sheets + Drive is the system of record)
    const parsedWorkOrders: ParsedWorkOrder[] = body.workOrders.map((wo: WorkOrderInput) => ({
      workOrderNumber: wo.workOrderNumber,
      scheduledDate: wo.scheduledDate || null,
      customerName: wo.customerName || null,
      serviceAddress: wo.serviceAddress || null,
      jobType: wo.jobType || null,
      jobDescription: wo.jobDescription || null,
      amount: wo.amount || null,
      currency: wo.currency || null,
      notes: wo.notes || null,
      priority: wo.priority || null,
      vendorName: wo.vendorName || null,
      timestampExtracted: wo.timestampExtracted || new Date().toISOString(),
      fmKey: null, // Not matched in this flow
    }));

    // Write directly to Google Sheets (no PDFs in this route, so no Drive upload)
    const accessToken = user?.googleAccessToken || null;
    if (accessToken) {
      try {
        const { getUserSpreadsheetId } = await import("@/lib/userSettings/repository");
        const { auth } = await import("@/auth");
        const { cookies } = await import("next/headers");
        
        // Check cookie first (session-based, no DB)
        const cookieSpreadsheetId = (await cookies()).get("googleSheetsSpreadsheetId")?.value || null;
        
        // Use cookie if available, otherwise check session/JWT token, then DB
        let spreadsheetId: string | null = null;
        if (cookieSpreadsheetId) {
          spreadsheetId = cookieSpreadsheetId;
        } else {
          // Then check session/JWT token
          const session = await auth();
          const sessionSpreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId : null;
          spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
        }
        if (spreadsheetId) {
          // Extract issuerKey from user email domain (for manual uploads)
          function extractIssuerKeyFromEmail(email: string | null | undefined): string {
            if (!email) return "manual";
            const emailMatch = email.match(/@([^\s>]+)/);
            if (emailMatch && emailMatch[1]) {
              const domain = emailMatch[1].toLowerCase().trim();
              const parts = domain.split(".");
              if (parts.length >= 2) {
                return parts.slice(-2).join("."); // e.g., "example.com" from "mail.example.com"
              }
              return domain;
            }
            return "manual";
          }

          const issuerKey = extractIssuerKeyFromEmail(user.email || null);
          console.log(`[work-orders] Using issuerKey: ${issuerKey}`);

          const { writeWorkOrdersToSheets } = await import("@/lib/workOrders/sheetsIngestion");
          await writeWorkOrdersToSheets(
            parsedWorkOrders,
            accessToken,
            spreadsheetId,
            issuerKey,
            undefined, // No PDF buffers for this route
            undefined, // No PDF filenames for this route
            "api" // Source: API endpoint
          );
          console.log("[work-orders] Successfully wrote work orders to Sheets");
        }
      } catch (sheetsError) {
        // Log but don't fail the request
        console.error("[work-orders] Error writing to Sheets:", sheetsError);
      }
    }

    // Return parsed work orders (matching the expected response format)
    return NextResponse.json({ workOrders: parsedWorkOrders }, { status: 200 });
  } catch (error) {
    console.error("Error saving work orders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/work-orders
 * Get all work orders for the authenticated user from Google Sheets.
 * 
 * Reads from Work_Orders sheet and maps to WorkOrder type.
 */
export async function GET() {
  try {
    // Require authentication
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Get Google access token
    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google authentication required. Please sign in with Google." },
        { status: 401 }
      );
    }

    // Get workspace (don't throw - return specific error code)
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const { rehydrateWorkspaceCookies } = await import("@/lib/workspace/workspaceCookies");
    const workspaceResult = await getWorkspace();
    
    if (!workspaceResult) {
      // Check cookies to determine if this is a "needs onboarding" vs "temporary error" case
      const { cookies } = await import("next/headers");
      const { readWorkspaceCookies } = await import("@/lib/workspace/workspaceCookies");
      const cookieStore = await cookies();
      const wsCookies = readWorkspaceCookies(cookieStore);
      
      const isWorkspaceReady = wsCookies.workspaceReady === "true" && wsCookies.spreadsheetId;
      
      if (!isWorkspaceReady) {
        // No workspace configured - return specific error code that frontend can handle
        return NextResponse.json(
          { 
            error: "Workspace not configured",
            needsOnboarding: true 
          },
          { status: 404 } // 404 = resource not found (workspace)
        );
      }
      
      // Cookie says ready but workspace couldn't be loaded - might be temporary error
      return NextResponse.json(
        { 
          error: "Workspace temporarily unavailable",
          needsOnboarding: false 
        },
        { status: 503 } // 503 = service temporarily unavailable
      );
    }
    
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    // Read Work_Orders sheet
    const { createSheetsClient, formatSheetRange, WORK_ORDER_REQUIRED_COLUMNS } = await import("@/lib/google/sheets");
    const { getColumnRange } = await import("@/lib/google/sheetsCache");
    const sheets = createSheetsClient(user.googleAccessToken);

    const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

    // Get all data from Work_Orders sheet
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(WORK_ORDERS_SHEET_NAME, getColumnRange(WORK_ORDER_REQUIRED_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      const response = NextResponse.json({ workOrders: [] }, { status: 200 });
      if (workspaceResult.source === "users_sheet") {
        rehydrateWorkspaceCookies(response, workspaceResult.workspace);
      }
      return response;
    }

    // First row is headers
    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => (h || "").toLowerCase().trim());

    // Helper to get column index by name (case-insensitive)
    const getIndex = (colName: string): number => {
      return headersLower.indexOf(colName.toLowerCase());
    };

    // Map data rows to WorkOrder type
    const workOrders: Array<import("@/lib/workOrders/types").WorkOrder> = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const woNumberCol = getIndex("wo_number");
      const jobIdCol = getIndex("jobid");
      
      // Skip rows without wo_number (required field)
      if (woNumberCol === -1 || !row[woNumberCol]) continue;

      const woNumber = String(row[woNumberCol] || "").trim();
      if (!woNumber) continue;

      const jobId = jobIdCol !== -1 && row[jobIdCol] ? String(row[jobIdCol]) : "";
      const createdAt = getIndex("created_at") !== -1 && row[getIndex("created_at")] 
        ? String(row[getIndex("created_at")]) 
        : new Date().toISOString();
      const timestampExtracted = getIndex("timestamp_extracted") !== -1 && row[getIndex("timestamp_extracted")]
        ? String(row[getIndex("timestamp_extracted")])
        : createdAt;

      // Map sheet columns to WorkOrder type
      const workOrder: import("@/lib/workOrders/types").WorkOrder = {
        id: jobId || `wo-${woNumber}-${i}`, // Fallback ID if jobId missing
        jobId: jobId || `wo-${woNumber}-${i}`,
        userId: getIndex("user_id") !== -1 && row[getIndex("user_id")] 
          ? String(row[getIndex("user_id")]) 
          : null,
        timestampExtracted,
        workOrderNumber: woNumber,
        fmKey: getIndex("fmkey") !== -1 && row[getIndex("fmkey")]
          ? String(row[getIndex("fmkey")]).trim()
          : null,
        status: getIndex("status") !== -1 && row[getIndex("status")]
          ? String(row[getIndex("status")]).trim()
          : null,
        customerName: getIndex("customer_name") !== -1 && row[getIndex("customer_name")]
          ? String(row[getIndex("customer_name")])
          : null,
        vendorName: getIndex("vendor_name") !== -1 && row[getIndex("vendor_name")]
          ? String(row[getIndex("vendor_name")])
          : null,
        serviceAddress: getIndex("service_address") !== -1 && row[getIndex("service_address")]
          ? String(row[getIndex("service_address")])
          : null,
        jobType: getIndex("job_type") !== -1 && row[getIndex("job_type")]
          ? String(row[getIndex("job_type")])
          : null,
        jobDescription: getIndex("job_description") !== -1 && row[getIndex("job_description")]
          ? String(row[getIndex("job_description")])
          : null,
        scheduledDate: getIndex("scheduled_date") !== -1 && row[getIndex("scheduled_date")]
          ? String(row[getIndex("scheduled_date")])
          : null,
        amount: getIndex("amount") !== -1 && row[getIndex("amount")]
          ? String(row[getIndex("amount")])
          : null,
        currency: getIndex("currency") !== -1 && row[getIndex("currency")]
          ? String(row[getIndex("currency")])
          : null,
        notes: getIndex("notes") !== -1 && row[getIndex("notes")]
          ? String(row[getIndex("notes")])
          : null,
        priority: getIndex("priority") !== -1 && row[getIndex("priority")]
          ? String(row[getIndex("priority")])
          : null,
        calendarEventLink: getIndex("calendar_event_link") !== -1 && row[getIndex("calendar_event_link")]
          ? String(row[getIndex("calendar_event_link")])
          : null,
        workOrderPdfLink: getIndex("work_order_pdf_link") !== -1 && row[getIndex("work_order_pdf_link")]
          ? String(row[getIndex("work_order_pdf_link")])
          : null,
        signedPdfUrl: getIndex("signed_pdf_url") !== -1 && row[getIndex("signed_pdf_url")]
          ? String(row[getIndex("signed_pdf_url")]).trim()
          : null,
        signedPreviewImageUrl: getIndex("signed_preview_image_url") !== -1 && row[getIndex("signed_preview_image_url")]
          ? String(row[getIndex("signed_preview_image_url")]).trim()
          : null,
        createdAt,
      };

      workOrders.push(workOrder);
    }

    console.log(`[Work Orders GET] Returning ${workOrders.length} work order(s)`);

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json({ workOrders }, { status: 200 });
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    return response;
  } catch (error) {
    console.error("Error fetching work orders:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/work-orders
 * Clear all work orders for the authenticated user.
 * 
 * Note: Since Sheets + Drive is the system of record, this endpoint
 * would need to delete from Sheets. For now, returns success.
 * TODO: Implement Sheets deletion if needed.
 */
export async function DELETE() {
  try {
    // Require authentication for Pro tier
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Sheets + Drive is the system of record - work orders are not stored in DB
    // To delete work orders, delete rows from Google Sheets directly
    // For now, return success
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error clearing work orders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

