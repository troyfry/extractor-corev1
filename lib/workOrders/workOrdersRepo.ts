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
      
      // NOTE: This function is deprecated - use ingestWorkOrderAuthoritative from lib/db/services/ingestWorkOrder.ts instead
      // This function uses the old schema with user_id, which no longer exists in the new schema.
      // The new schema uses workspace_id instead.
      throw new Error(
        "upsertWorkOrders is deprecated. Use ingestWorkOrderAuthoritative from lib/db/services/ingestWorkOrder.ts instead. " +
        "The new schema uses workspace_id instead of user_id."
      );
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
  // NOTE: This function is deprecated - the new schema uses workspace_id instead of user_id
  // Use workspace-based queries instead
  throw new Error(
    "listInvoiceReadyWorkOrders is deprecated. The new schema uses workspace_id instead of user_id. " +
    "Use workspace-based queries with the new schema."
  );
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

  // NOTE: This function is deprecated - the new schema uses workspace_id instead of user_id
  throw new Error(
    "markWorkOrderSignedByNumberLatest is deprecated. The new schema uses workspace_id instead of user_id. " +
    "Use ingestSignedAuthoritative from lib/db/services/ingestSigned.ts instead."
  );
}
