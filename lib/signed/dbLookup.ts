// lib/signed/dbLookup.ts
import { db } from "@/lib/db/drizzle";
import { work_orders, fm_profiles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface FindWorkOrderByWoNumberParams {
  workspaceId: string;
  fmProfileId?: string | null;
  workOrderNumber: string;
}

export interface FindWorkOrderByWoNumberResult {
  work_order_id: string;
  job_id: string;
  status: string;
  customer_name: string | null;
  service_address: string | null;
}

/**
 * Find work order by work order number (for signed document matching).
 * This is an optional DB lookup helper that can be used instead of Sheets lookup.
 * 
 * Feature flag: DB_SIGNED_LOOKUP (default: OFF)
 * 
 * @param params - Search parameters
 * @returns Work order details or null if not found
 */
export async function findWorkOrderByWoNumber(
  params: FindWorkOrderByWoNumberParams
): Promise<FindWorkOrderByWoNumberResult | null> {
  const { workspaceId, fmProfileId, workOrderNumber } = params;

  // Build WHERE conditions
  const conditions = [
    eq(work_orders.workspace_id, workspaceId),
    eq(work_orders.work_order_number, workOrderNumber),
  ];

  // If fmProfileId is provided, also filter by fm_key
  if (fmProfileId) {
    // Get fm_key from fm_profiles
    const [fmProfile] = await db
      .select({ fm_key: fm_profiles.fm_key })
      .from(fm_profiles)
      .where(and(
        eq(fm_profiles.id, fmProfileId),
        eq(fm_profiles.workspace_id, workspaceId)
      ))
      .limit(1);

    if (fmProfile) {
      conditions.push(eq(work_orders.fm_key, fmProfile.fm_key));
    }
  }

  // Query work order
  const [workOrder] = await db
    .select({
      work_order_id: work_orders.id,
      job_id: work_orders.job_id,
      status: work_orders.status,
      customer_name: work_orders.customer_name,
      service_address: work_orders.service_address,
    })
    .from(work_orders)
    .where(and(...conditions))
    .limit(1);

  return workOrder || null;
}

/**
 * Check if DB signed lookup is enabled via feature flag.
 */
export function isDbSignedLookupEnabled(): boolean {
  return process.env.DB_SIGNED_LOOKUP === "true" || process.env.DB_SIGNED_LOOKUP === "1";
}
