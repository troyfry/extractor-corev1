import { db } from "@/lib/db/drizzle";
import { work_orders } from "@/lib/db/schema";
import type { ParsedWorkOrder } from "./parsedTypes";
import { eq, inArray, and, sql, desc } from "drizzle-orm";
import crypto from "crypto";

/**
 * Normalize amount string to numeric format suitable for database.
 * Converts "$200.00" or "200" to a clean numeric string.
 */
function normalizeAmountToNumeric(input: string | null | undefined): string | null {
  if (!input) return null;
  
  // Remove currency symbols, commas, and whitespace
  const cleaned = input.replace(/[$,\s]/g, "");
  
  // Extract numeric value (including decimals)
  const match = cleaned.match(/^-?\d+(\.\d+)?/);
  if (!match) return null;
  
  return match[0];
}

/**
 * Derive a stable jobId from workOrderNumber if jobId is missing.
 * Falls back to workOrderNumber itself (normalized) if available.
 */
function deriveJobId(parsedWorkOrder: ParsedWorkOrder & { jobId?: string | null }): string {
  // If jobId is explicitly provided, use it
  if (parsedWorkOrder.jobId) {
    return parsedWorkOrder.jobId;
  }
  
  // Fallback: use workOrderNumber if available
  if (parsedWorkOrder.workOrderNumber) {
    // Normalize workOrderNumber for use as jobId
    return parsedWorkOrder.workOrderNumber.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  }
  
  // Last resort: generate a timestamp-based ID
  return `fallback_${Date.now()}`;
}

/**
 * Upsert multiple work orders to Postgres in a transaction.
 * 
 * @param userId User ID (required)
 * @param parsedWorkOrders Array of parsed work orders
 * @returns Summary of operation: { insertedOrUpdated: number, missingJobIdCount: number }
 */
export async function upsertWorkOrders(
  userId: string,
  parsedWorkOrders: (ParsedWorkOrder & { jobId?: string | null })[]
): Promise<{ insertedOrUpdated: number; missingJobIdCount: number }> {
  if (parsedWorkOrders.length === 0) {
    return { insertedOrUpdated: 0, missingJobIdCount: 0 };
  }

  let missingJobIdCount = 0;
  let insertedOrUpdated = 0;

  // Process in a transaction for atomicity
  await db.transaction(async (tx) => {
    for (const parsedWorkOrder of parsedWorkOrders) {
      // Derive jobId - use provided jobId or fallback to workOrderNumber
      const jobId = deriveJobId(parsedWorkOrder);
      
      // Track if we had to use fallback
      if (!parsedWorkOrder.jobId) {
        missingJobIdCount++;
        console.warn(
          `[Postgres] Missing jobId for work order "${parsedWorkOrder.workOrderNumber ?? "(unknown)"}", ` +
          `using derived jobId: ${jobId}`
        );
      }
      
      // Generate a unique ID for the work order
      const id = crypto.randomUUID();
      
      // Normalize amount
      const normalizedAmount = normalizeAmountToNumeric(parsedWorkOrder.amount);
      
      // Map ParsedWorkOrder to database schema
      const workOrderData = {
        id,
        user_id: userId,
        job_id: jobId,
        work_order_number: parsedWorkOrder.workOrderNumber || null,
        scheduled_date: parsedWorkOrder.scheduledDate || null,
        customer_name: parsedWorkOrder.customerName || null,
        service_address: parsedWorkOrder.serviceAddress || null,
        job_description: parsedWorkOrder.jobDescription || null,
        amount: normalizedAmount,
        currency: parsedWorkOrder.currency || "USD",
        status: "NEW",
        created_at: new Date(parsedWorkOrder.timestampExtracted || new Date().toISOString()),
        updated_at: new Date(),
      };

      try {
        await tx
          .insert(work_orders)
          .values(workOrderData)
          .onConflictDoUpdate({
            target: [work_orders.user_id, work_orders.job_id],
            set: {
              work_order_number: workOrderData.work_order_number,
              scheduled_date: workOrderData.scheduled_date,
              customer_name: workOrderData.customer_name,
              service_address: workOrderData.service_address,
              job_description: workOrderData.job_description,
              amount: workOrderData.amount,
              currency: workOrderData.currency,
              status: workOrderData.status,
              updated_at: new Date(),
              // Note: created_at is NOT updated on conflict
            },
          });
        
        insertedOrUpdated++;
      } catch (error) {
        console.error(
          `[Postgres] ❌ Error upserting work order ${jobId} (wo_number: ${parsedWorkOrder.workOrderNumber}):`,
          error
        );
        throw error; // Re-throw to rollback transaction
      }
    }
  });
  
  console.log(
    `[Postgres] ✅ Upserted ${insertedOrUpdated} work order(s) for user ${userId} ` +
    `(${missingJobIdCount} had missing jobId and used fallback)`
  );
  
  return { insertedOrUpdated, missingJobIdCount };
}

/**
 * List invoice-ready work orders for a user.
 * Invoice-ready = status IN ('SIGNED', 'READY_TO_INVOICE').
 * 
 * @param userId User ID
 * @returns Array of work order records with invoice-ready status
 */
export async function listInvoiceReadyWorkOrders(userId: string): Promise<any[]> {
  const results = await db
    .select({
      job_id: work_orders.job_id,
      work_order_number: work_orders.work_order_number,
      scheduled_date: work_orders.scheduled_date,
      customer_name: work_orders.customer_name,
      service_address: work_orders.service_address,
      job_description: work_orders.job_description,
      amount: work_orders.amount,
      currency: work_orders.currency,
      status: work_orders.status,
      created_at: work_orders.created_at,
      updated_at: work_orders.updated_at,
    })
    .from(work_orders)
    .where(
      and(
        eq(work_orders.user_id, userId),
        inArray(work_orders.status, ["SIGNED", "READY_TO_INVOICE"])
      )
    )
    .orderBy(
      // Order by scheduled_date DESC, fallback to created_at DESC if scheduled_date is null
      sql`${work_orders.scheduled_date} DESC NULLS LAST, ${work_orders.created_at} DESC`
    );

  return results;
}

/**
 * Mark the most recent work order as SIGNED by work order number.
 * Updates ONLY the most recent matching row (by created_at DESC, updated_at DESC).
 * 
 * @param userId User ID
 * @param workOrderNumber Work order number to match
 * @returns true if updated, false if no matching row found
 */
export async function markWorkOrderSignedByNumberLatest(
  userId: string,
  workOrderNumber: string
): Promise<boolean> {
  // Validate inputs
  const trimmedUserId = userId?.trim();
  const trimmedWoNumber = workOrderNumber?.trim();
  
  if (!trimmedUserId) {
    throw new Error("userId is required and must not be empty");
  }
  if (!trimmedWoNumber) {
    throw new Error("workOrderNumber is required and must not be empty");
  }

  // Step 1: Find the most recent matching row by id
  const mostRecentRow = await db
    .select({ id: work_orders.id })
    .from(work_orders)
    .where(
      and(
        eq(work_orders.user_id, trimmedUserId),
        eq(work_orders.work_order_number, trimmedWoNumber)
      )
    )
    .orderBy(desc(work_orders.created_at), desc(work_orders.updated_at))
    .limit(1);

  if (mostRecentRow.length === 0) {
    console.warn(
      `[Postgres] ⚠️ No work order found to mark as SIGNED: ` +
      `WO=${trimmedWoNumber} user=${trimmedUserId}`
    );
    return false;
  }

  const targetId = mostRecentRow[0].id;

  // Step 2: Update that specific row
  const result = await db
    .update(work_orders)
    .set({
      status: "SIGNED",
      updated_at: new Date(),
    })
    .where(eq(work_orders.id, targetId));

  const rowsUpdated = result.rowCount ?? 0;

  if (rowsUpdated === 1) {
    console.log(
      `[Postgres] ✅ SIGNED status set for WO=${trimmedWoNumber} user=${trimmedUserId}`
    );
    return true;
  } else {
    console.warn(
      `[Postgres] ⚠️ Unexpected rowCount after update: ${rowsUpdated} (expected 1) ` +
      `for WO=${trimmedWoNumber} user=${trimmedUserId}`
    );
    return false;
  }
}
