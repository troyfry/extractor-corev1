// app/api/db/reconcile/sample/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { listWorkOrders } from "@/lib/db/services/workOrders";
import { getWorkspace } from "@/lib/workspace/getWorkspace";
import { createSheetsClient, formatSheetRange, WORK_ORDER_REQUIRED_COLUMNS } from "@/lib/google/sheets";
import { getColumnRange } from "@/lib/google/sheetsCache";

export const runtime = "nodejs";

interface WorkOrderKey {
  workOrderNumber: string;
  fmKey: string | null;
}

interface LegacyWorkOrder extends WorkOrderKey {
  id: string;
  status: string | null;
  signedAt: string | null;
  amount: string | null;
  scheduledDate: string | null;
}

/**
 * GET /api/db/reconcile/sample
 * Compare latest 50 work orders from DB vs Legacy (Sheets).
 * Returns differences for diagnostics.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || !user.googleAccessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 400 }
      );
    }

    // Get DB work orders (latest 50)
    const dbResult = await listWorkOrders(workspaceId, {}, { limit: 50 });
    const dbWorkOrders = dbResult.items;

    // Get Legacy work orders (from Sheets)
    const workspaceResult = await getWorkspace();
    if (!workspaceResult) {
      return NextResponse.json(
        { error: "Workspace not available" },
        { status: 400 }
      );
    }

    const spreadsheetId = workspaceResult.workspace.spreadsheetId;
    const sheets = createSheetsClient(user.googleAccessToken);
    const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(WORK_ORDERS_SHEET_NAME, getColumnRange(WORK_ORDER_REQUIRED_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => (h || "").toLowerCase().trim());
    const getIndex = (colName: string): number => headersLower.indexOf(colName.toLowerCase());

    const legacyWorkOrders: LegacyWorkOrder[] = [];
    for (let i = 1; i < Math.min(rows.length, 51); i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const woNumberCol = getIndex("wo_number");
      const jobIdCol = getIndex("jobid");
      const fmKeyCol = getIndex("fmkey");
      const statusCol = getIndex("status");
      const signedAtCol = getIndex("signed_at");
      const amountCol = getIndex("amount");
      const scheduledDateCol = getIndex("scheduled_date");

      if (woNumberCol === -1 || !row[woNumberCol]) continue;

      const woNumber = String(row[woNumberCol] || "").trim();
      if (!woNumber) continue;

      const jobId = jobIdCol !== -1 && row[jobIdCol] ? String(row[jobIdCol]) : `legacy-${woNumber}-${i}`;
      const fmKey = fmKeyCol !== -1 && row[fmKeyCol] ? String(row[fmKeyCol]).trim() : null;
      const status = statusCol !== -1 && row[statusCol] ? String(row[statusCol]).trim() : null;
      const signedAt = signedAtCol !== -1 && row[signedAtCol] ? String(row[signedAtCol]).trim() : null;
      const amount = amountCol !== -1 && row[amountCol] ? String(row[amountCol]).trim() : null;
      const scheduledDate = scheduledDateCol !== -1 && row[scheduledDateCol] ? String(row[scheduledDateCol]).trim() : null;

      legacyWorkOrders.push({
        id: jobId,
        workOrderNumber: woNumber,
        fmKey,
        status,
        signedAt,
        amount,
        scheduledDate,
      });
    }

    // Create key sets for comparison
    const dbKeySet = new Set(
      dbWorkOrders.map((wo) => `${wo.work_order_number || ""}:${wo.fm_key || ""}`)
    );
    const legacyKeySet = new Set(
      legacyWorkOrders.map((wo) => `${wo.workOrderNumber}:${wo.fmKey || ""}`)
    );

    // Find differences
    const onlyInDb: WorkOrderKey[] = dbWorkOrders
      .filter((wo) => {
        const key = `${wo.work_order_number || ""}:${wo.fm_key || ""}`;
        return !legacyKeySet.has(key);
      })
      .map((wo) => ({
        workOrderNumber: wo.work_order_number || "",
        fmKey: wo.fm_key,
      }));

    const onlyInLegacy: WorkOrderKey[] = legacyWorkOrders
      .filter((wo) => {
        const key = `${wo.workOrderNumber}:${wo.fmKey || ""}`;
        return !dbKeySet.has(key);
      })
      .map((wo) => ({
        workOrderNumber: wo.workOrderNumber,
        fmKey: wo.fmKey,
      }));

    const inBoth = Math.min(
      dbWorkOrders.filter((wo) => {
        const key = `${wo.work_order_number || ""}:${wo.fm_key || ""}`;
        return legacyKeySet.has(key);
      }).length,
      legacyWorkOrders.filter((wo) => {
        const key = `${wo.workOrderNumber}:${wo.fmKey || ""}`;
        return dbKeySet.has(key);
      }).length
    );

    // Field drift analysis for a sample of matched work orders
    const matchedDb = dbWorkOrders.filter((wo) => {
      const key = `${wo.work_order_number || ""}:${wo.fm_key || ""}`;
      return legacyKeySet.has(key);
    });

    const matchedLegacy = legacyWorkOrders.filter((wo) => {
      const key = `${wo.workOrderNumber}:${wo.fmKey || ""}`;
      return dbKeySet.has(key);
    });

    // Compare fields for matched work orders (sample of 20)
    const fieldDrifts: Array<{
      workOrderNumber: string;
      fmKey: string | null;
      field: string;
      dbValue: string | null;
      legacyValue: string | null;
    }> = [];

    const sampleSize = Math.min(20, matchedDb.length, matchedLegacy.length);
    for (let i = 0; i < sampleSize; i++) {
      const dbWo = matchedDb[i];
      const legacyWo = matchedLegacy.find(
        (wo) => wo.workOrderNumber === dbWo.work_order_number && wo.fmKey === dbWo.fm_key
      );

      if (!legacyWo) continue;

      // Compare status
      if (dbWo.status !== legacyWo.status) {
        fieldDrifts.push({
          workOrderNumber: dbWo.work_order_number || "",
          fmKey: dbWo.fm_key,
          field: "status",
          dbValue: dbWo.status,
          legacyValue: legacyWo.status || null,
        });
      }

      // Compare signed_at presence
      const dbHasSignedAt = !!dbWo.signed_at;
      const legacyHasSignedAt = !!legacyWo.signedAt;
      if (dbHasSignedAt !== legacyHasSignedAt) {
        fieldDrifts.push({
          workOrderNumber: dbWo.work_order_number || "",
          fmKey: dbWo.fm_key,
          field: "signed_at_presence",
          dbValue: dbHasSignedAt ? "present" : "absent",
          legacyValue: legacyHasSignedAt ? "present" : "absent",
        });
      }

      // Compare amount (normalize for comparison)
      const dbAmount = dbWo.amount ? String(dbWo.amount).trim() : null;
      const legacyAmount = legacyWo.amount ? String(legacyWo.amount).trim() : null;
      if (dbAmount !== legacyAmount) {
        fieldDrifts.push({
          workOrderNumber: dbWo.work_order_number || "",
          fmKey: dbWo.fm_key,
          field: "amount",
          dbValue: dbAmount,
          legacyValue: legacyAmount,
        });
      }

      // Compare scheduled_date
      const dbScheduledDate = dbWo.scheduled_date ? String(dbWo.scheduled_date).trim() : null;
      const legacyScheduledDate = legacyWo.scheduledDate ? String(legacyWo.scheduledDate).trim() : null;
      if (dbScheduledDate !== legacyScheduledDate) {
        fieldDrifts.push({
          workOrderNumber: dbWo.work_order_number || "",
          fmKey: dbWo.fm_key,
          field: "scheduled_date",
          dbValue: dbScheduledDate,
          legacyValue: legacyScheduledDate,
        });
      }
    }

    // Count mismatches by field
    const driftCounts = {
      status: fieldDrifts.filter((d) => d.field === "status").length,
      signed_at_presence: fieldDrifts.filter((d) => d.field === "signed_at_presence").length,
      amount: fieldDrifts.filter((d) => d.field === "amount").length,
      scheduled_date: fieldDrifts.filter((d) => d.field === "scheduled_date").length,
    };

    return NextResponse.json({
      dbCount: dbWorkOrders.length,
      legacyCount: legacyWorkOrders.length,
      inBoth,
      onlyInDb: onlyInDb.slice(0, 20), // Limit to 20 for display
      onlyInLegacy: onlyInLegacy.slice(0, 20), // Limit to 20 for display
      differences: onlyInDb.length + onlyInLegacy.length,
      fieldDrifts: {
        counts: driftCounts,
        totalMismatches: fieldDrifts.length,
        sample: fieldDrifts.slice(0, 20), // Limit to 20 for display
      },
    });
  } catch (error) {
    console.error("[DB Reconcile Sample API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
