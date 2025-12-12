/**
 * Mapper functions to convert between database models and API/UI types.
 * 
 * The database uses Date objects for timestamps, while the API/UI layer
 * uses ISO string representations for dates.
 * 
 * Architecture:
 * - DBWorkOrder (from db/schema.ts) has Date fields
 * - WorkOrder (from types.ts) has ISO string fields
 * - These mappers handle the conversion
 */
import type { DBWorkOrder, DBWorkOrderInsert } from "@/db/schema";
import type { WorkOrder, WorkOrderInput } from "./types";

/**
 * Convert a database work order row to the API/UI WorkOrder type.
 * Converts Date fields to ISO strings and decimal to string.
 */
export function dbToWorkOrder(dbRow: DBWorkOrder): WorkOrder {
  return {
    id: dbRow.id,
    userId: dbRow.userId ?? null,
    timestampExtracted: dbRow.timestampExtracted?.toISOString() || new Date().toISOString(),
    workOrderNumber: dbRow.workOrderNumber,
    customerName: dbRow.customerName ?? null,
    vendorName: dbRow.vendorName ?? null,
    serviceAddress: dbRow.serviceAddress ?? null,
    jobType: dbRow.jobType ?? null,
    jobDescription: dbRow.jobDescription ?? null,
    scheduledDate: dbRow.scheduledDate?.toISOString() ?? null,
    amount: dbRow.amount ?? null,
    currency: dbRow.currency ?? null,
    notes: dbRow.notes ?? null,
    priority: dbRow.priority ?? null,
    calendarEventLink: dbRow.calendarEventLink ?? null,
    workOrderPdfLink: dbRow.workOrderPdfLink ?? null,
    createdAt: dbRow.createdAt.toISOString(),
  };
}

/**
 * Sanitize amount string to a valid decimal format for database insertion.
 * Removes currency symbols, commas, and other non-numeric characters except decimal point.
 * 
 * Examples:
 * - "$867.00" → "867.00"
 * - "$1,234.56" → "1234.56"
 * - "867" → "867"
 * - "" or null → null
 */
function sanitizeAmount(amount: string | null | undefined): string | null {
  if (!amount || typeof amount !== 'string') {
    return null;
  }
  
  // Remove all non-numeric characters except decimal point
  const sanitized = amount.replace(/[^0-9.]/g, '');
  
  // If empty after sanitization, return null
  if (!sanitized || sanitized === '.') {
    return null;
  }
  
  // Validate it's a valid number
  const num = parseFloat(sanitized);
  if (isNaN(num)) {
    return null;
  }
  
  // Return as string with up to 2 decimal places
  return num.toFixed(2);
}

/**
 * Convert a WorkOrderInput to a database insert type.
 * Converts ISO string dates to Date objects for database insertion.
 * Sanitizes amount string to valid decimal format.
 */
export function inputToDbInsert(input: WorkOrderInput): DBWorkOrderInsert {
  return {
    id: input.id,
    userId: input.userId ?? null, // Optional: defaults to null for free version
    timestampExtracted: input.timestampExtracted ? new Date(input.timestampExtracted) : undefined,
    workOrderNumber: input.workOrderNumber,
    customerName: input.customerName ?? null,
    vendorName: input.vendorName ?? null,
    serviceAddress: input.serviceAddress ?? null,
    jobType: input.jobType ?? null,
    jobDescription: input.jobDescription ?? null,
    scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : null,
    amount: sanitizeAmount(input.amount),
    currency: input.currency ?? null,
    notes: input.notes ?? null,
    priority: input.priority ?? null,
    calendarEventLink: input.calendarEventLink ?? null,
    workOrderPdfLink: input.workOrderPdfLink ?? null,
    createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
  };
}

