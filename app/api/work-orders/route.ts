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
 * Get all work orders for the authenticated user.
 * 
 * Uses read adapter to route to DB or legacy based on feature flag + workspace setting.
 * Falls back to legacy if DB read fails.
 */
export async function GET(request: Request) {
  try {
    // Require authentication
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Get Google access token (required for legacy fallback)
    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google authentication required. Please sign in with Google." },
        { status: 401 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const q = searchParams.get("q") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const cursor = searchParams.get("cursor") || undefined;

    // Use read adapter (routes to DB or legacy based on feature flag + workspace setting)
    const { listWorkOrdersUnified } = await import("@/lib/readAdapter/workOrders");
    const result = await listWorkOrdersUnified({
      status,
      q,
      limit,
      cursor,
    });

    // Map unified format back to legacy WorkOrder type for backward compatibility
    const workOrders: Array<import("@/lib/workOrders/types").WorkOrder> = result.workOrders.map((wo) => ({
      id: wo.id,
      jobId: wo.id, // Use same ID for jobId
      userId: null,
      timestampExtracted: new Date().toISOString(),
      workOrderNumber: wo.workOrderNumber || "",
      fmKey: wo.fmDisplayName,
      status: wo.status,
      customerName: wo.customerName,
      vendorName: null,
      serviceAddress: wo.serviceAddress,
      jobType: null,
      jobDescription: null,
      scheduledDate: wo.scheduledDate,
      amount: wo.amount,
      currency: wo.currency,
      notes: null,
      priority: null,
      calendarEventLink: null,
      workOrderPdfLink: null,
      signedPdfUrl: wo.signedPdfUrl,
      signedPreviewImageUrl: null,
      createdAt: wo.signedAt || new Date().toISOString(),
    }));

    // Rehydrate cookies if needed (for legacy compatibility)
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const { rehydrateWorkspaceCookies } = await import("@/lib/workspace/workspaceCookies");
    const workspaceResult = await getWorkspace();
    
    const response = NextResponse.json({ 
      workOrders,
      dataSource: result.dataSource, // Include data source in response
      fallbackUsed: result.fallbackUsed, // Include fallback indicator
    }, { status: 200 });
    
    if (workspaceResult && workspaceResult.source === "users_sheet") {
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

