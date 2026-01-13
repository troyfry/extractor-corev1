// lib/readAdapter/workOrders.ts
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getPrimaryReadSource } from "@/lib/db/services/workspace";
import { listWorkOrders } from "@/lib/db/services/workOrders";
import type { WorkOrder } from "@/lib/workOrders/types";

export interface UnifiedWorkOrder {
  id: string;
  workOrderNumber: string | null;
  customerName: string | null;
  serviceAddress: string | null;
  scheduledDate: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  signedAt: string | null;
  signedPdfUrl: string | null;
  fmDisplayName: string | null;
  exportStatus: "EXPORTED" | "PENDING" | "FAILED" | "FAILED_QUOTA" | null;
}

export interface ListWorkOrdersUnifiedParams {
  status?: string;
  q?: string; // Search query
  limit?: number;
  cursor?: string;
}

export interface ListWorkOrdersUnifiedResult {
  workOrders: UnifiedWorkOrder[];
  nextCursor: string | null;
  hasMore: boolean;
  dataSource: "DB" | "LEGACY";
  fallbackUsed: boolean; // true if DB failed and fell back to legacy
}

/**
 * Check if DB primary reads are enabled via feature flag.
 */
function isDbPrimaryReadsEnabled(): boolean {
  return process.env.DB_PRIMARY_READS === "true" || process.env.DB_PRIMARY_READS === "1";
}

/**
 * Unified work orders list adapter.
 * Routes to DB or legacy based on feature flag + workspace setting.
 * Falls back to legacy if DB read fails.
 */
export async function listWorkOrdersUnified(
  params: ListWorkOrdersUnifiedParams = {}
): Promise<ListWorkOrdersUnifiedResult> {
  const { status, q, limit, cursor } = params;

  // Check feature flag
  const dbPrimaryReadsEnabled = isDbPrimaryReadsEnabled();
  
  if (!dbPrimaryReadsEnabled) {
    // Feature flag OFF - use legacy
    return await listWorkOrdersLegacy(params);
  }

  // Feature flag ON - check workspace setting
  try {
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      // No workspace - fallback to legacy
      console.log("[Read Adapter] No workspace found, using legacy");
      return await listWorkOrdersLegacy(params);
    }

    const primaryReadSource = await getPrimaryReadSource(workspaceId);
    
    if (primaryReadSource !== "DB") {
      // Workspace setting is LEGACY - use legacy
      console.log("[Read Adapter] Workspace primary_read_source is LEGACY, using legacy");
      return await listWorkOrdersLegacy(params);
    }

    // Workspace setting is DB - try DB read
    try {
      const dbResult = await listWorkOrders(
        workspaceId,
        {
          status,
          search: q,
        },
        {
          limit,
          cursor,
        }
      );

      // Map DB result to unified format
      const unifiedWorkOrders: UnifiedWorkOrder[] = dbResult.items.map((wo) => ({
        id: wo.id,
        workOrderNumber: wo.work_order_number,
        customerName: wo.customer_name,
        serviceAddress: wo.service_address,
        scheduledDate: wo.scheduled_date,
        amount: wo.amount,
        currency: wo.currency,
        status: wo.status,
        signedAt: wo.signed_at?.toISOString() || null,
        signedPdfUrl: wo.signed_pdf_url,
        fmDisplayName: wo.fm_profile_display_name,
        exportStatus: wo.export_status,
      }));

      return {
        workOrders: unifiedWorkOrders,
        nextCursor: dbResult.nextCursor,
        hasMore: dbResult.hasMore,
        dataSource: "DB",
        fallbackUsed: false,
      };
    } catch (dbError) {
      // DB read failed - fallback to legacy
      console.error("[Read Adapter] DB read failed, falling back to legacy:", dbError);
      const legacyResult = await listWorkOrdersLegacy(params);
      return {
        ...legacyResult,
        fallbackUsed: true, // Indicate that fallback was used
      };
    }
  } catch (error) {
    // Workspace lookup failed - fallback to legacy
    console.error("[Read Adapter] Workspace lookup failed, falling back to legacy:", error);
    const legacyResult = await listWorkOrdersLegacy(params);
    return {
      ...legacyResult,
      fallbackUsed: true,
    };
  }
}

/**
 * Legacy work orders list (from Sheets).
 * This calls the existing legacy service functions directly.
 */
async function listWorkOrdersLegacy(
  params: ListWorkOrdersUnifiedParams
): Promise<ListWorkOrdersUnifiedResult> {
  // Import legacy service functions
  const { getCurrentUser } = await import("@/auth");
  const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
  const { createSheetsClient, formatSheetRange, WORK_ORDER_REQUIRED_COLUMNS } = await import("@/lib/google/sheets");
  const { getColumnRange } = await import("@/lib/google/sheetsCache");

  const user = await getCurrentUser();
  
  if (!user || !user.googleAccessToken) {
    return {
      workOrders: [],
      nextCursor: null,
      hasMore: false,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  }

  try {
    // Get workspace
    const workspaceResult = await getWorkspace();
    if (!workspaceResult) {
      return {
        workOrders: [],
        nextCursor: null,
        hasMore: false,
        dataSource: "LEGACY",
        fallbackUsed: false,
      };
    }

    const spreadsheetId = workspaceResult.workspace.spreadsheetId;
    const sheets = createSheetsClient(user.googleAccessToken);
    const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

    // Read from Work_Orders sheet (same logic as legacy API)
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(WORK_ORDERS_SHEET_NAME, getColumnRange(WORK_ORDER_REQUIRED_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return {
        workOrders: [],
        nextCursor: null,
        hasMore: false,
        dataSource: "LEGACY",
        fallbackUsed: false,
      };
    }

    // First row is headers
    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => (h || "").toLowerCase().trim());
    const getIndex = (colName: string): number => headersLower.indexOf(colName.toLowerCase());

    // Map data rows to unified format
    const unifiedWorkOrders: UnifiedWorkOrder[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const woNumberCol = getIndex("wo_number");
      const jobIdCol = getIndex("jobid");
      
      if (woNumberCol === -1 || !row[woNumberCol]) continue;

      const woNumber = String(row[woNumberCol] || "").trim();
      if (!woNumber) continue;

      const jobId = jobIdCol !== -1 && row[jobIdCol] ? String(row[jobIdCol]) : `legacy-${woNumber}-${i}`;

      // Apply filters if provided
      if (params.status) {
        const statusCol = getIndex("status");
        const rowStatus = statusCol !== -1 ? String(row[statusCol] || "").trim() : null;
        if (rowStatus?.toUpperCase() !== params.status.toUpperCase()) {
          continue;
        }
      }

      if (params.q) {
        const query = params.q.toLowerCase();
        const matchesWoNumber = woNumber.toLowerCase().includes(query);
        const fmKeyCol = getIndex("fmkey");
        const fmKey = fmKeyCol !== -1 ? String(row[fmKeyCol] || "").toLowerCase() : "";
        const matchesFmKey = fmKey.includes(query);
        const customerCol = getIndex("customer_name");
        const customer = customerCol !== -1 ? String(row[customerCol] || "").toLowerCase() : "";
        const matchesCustomer = customer.includes(query);
        
        if (!matchesWoNumber && !matchesFmKey && !matchesCustomer) {
          continue;
        }
      }

      unifiedWorkOrders.push({
        id: jobId,
        workOrderNumber: woNumber,
        customerName: getIndex("customer_name") !== -1 ? String(row[getIndex("customer_name")] || "") : null,
        serviceAddress: getIndex("service_address") !== -1 ? String(row[getIndex("service_address")] || "") : null,
        scheduledDate: getIndex("scheduled_date") !== -1 ? String(row[getIndex("scheduled_date")] || "") : null,
        amount: getIndex("amount") !== -1 ? String(row[getIndex("amount")] || "") : null,
        currency: getIndex("currency") !== -1 ? String(row[getIndex("currency")] || "") : null,
        status: getIndex("status") !== -1 ? String(row[getIndex("status")] || "").trim() : "OPEN",
        signedAt: getIndex("signed_at") !== -1 ? String(row[getIndex("signed_at")] || "") : null,
        signedPdfUrl: getIndex("signed_pdf_url") !== -1 ? String(row[getIndex("signed_pdf_url")] || "").trim() : null,
        fmDisplayName: getIndex("fmkey") !== -1 ? String(row[getIndex("fmkey")] || "").trim() : null,
        exportStatus: null, // Legacy doesn't have export status
      });
    }

    // Apply limit if provided (client-side pagination for legacy)
    const limitedWorkOrders = params.limit 
      ? unifiedWorkOrders.slice(0, params.limit)
      : unifiedWorkOrders;

    return {
      workOrders: limitedWorkOrders,
      nextCursor: null, // Legacy doesn't support cursor pagination
      hasMore: params.limit ? unifiedWorkOrders.length > params.limit : false,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  } catch (error) {
    console.error("[Read Adapter] Legacy read failed:", error);
    return {
      workOrders: [],
      nextCursor: null,
      hasMore: false,
      dataSource: "LEGACY",
      fallbackUsed: false,
    };
  }
}
