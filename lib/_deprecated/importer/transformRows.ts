/**
 * Transform external sheet rows into canonical work order records.
 * 
 * Maps external column names to canonical format based on ImportMapping.
 */

import type { CanonicalWorkOrderRecord, ImportMapping } from "./types";
import { generateJobId } from "@/lib/workOrders/sheetsIngestion";

/**
 * Transform a single external row into a canonical work order record.
 * 
 * @param externalRow Array of cell values from external sheet
 * @param externalHeaders Array of header names from external sheet
 * @param mapping Column mapping from external to canonical
 * @param issuerKey Issuer key for generating jobId (optional, defaults to "external")
 * @returns Canonical work order record
 */
export function transformRow(
  externalRow: string[],
  externalHeaders: string[],
  mapping: ImportMapping,
  issuerKey: string = "external"
): CanonicalWorkOrderRecord {
  // Create a map of external header name -> column index
  const headerIndexMap: Record<string, number> = {};
  externalHeaders.forEach((header, index) => {
    headerIndexMap[header.toLowerCase().trim()] = index;
  });

  // Helper to get value from external row by header name
  const getValue = (headerName: string): string | null => {
    if (!headerName) return null;
    const index = headerIndexMap[headerName.toLowerCase().trim()];
    if (index === undefined) return null;
    const value = externalRow[index];
    return value ? String(value).trim() : null;
  };

  // Get work order number (required)
  const woNumber = getValue(mapping.wo_number);
  if (!woNumber) {
    throw new Error(`Work order number is required but not found in column "${mapping.wo_number}"`);
  }

  // Generate jobId
  const fmKey = mapping.fmKey ? getValue(mapping.fmKey) : null;
  const jobId = generateJobId(fmKey || issuerKey, woNumber);

  // Get all mapped values
  const now = new Date().toISOString();

  const record: CanonicalWorkOrderRecord = {
    jobId,
    fmKey: mapping.fmKey ? getValue(mapping.fmKey) : null,
    wo_number: woNumber,
    status: mapping.status ? (getValue(mapping.status) || "pending") : "pending",
    scheduled_date: mapping.scheduled_date ? getValue(mapping.scheduled_date) : null,
    created_at: now,
    timestamp_extracted: now,
    customer_name: mapping.customer_name ? getValue(mapping.customer_name) : null,
    vendor_name: mapping.vendor_name ? getValue(mapping.vendor_name) : null,
    service_address: mapping.service_address ? getValue(mapping.service_address) : null,
    job_type: mapping.job_type ? getValue(mapping.job_type) : null,
    job_description: mapping.job_description ? getValue(mapping.job_description) : null,
    amount: mapping.amount ? getValue(mapping.amount) : null,
    currency: mapping.currency ? getValue(mapping.currency) : null,
    notes: mapping.notes ? getValue(mapping.notes) : null,
    priority: mapping.priority ? getValue(mapping.priority) : null,
    calendar_event_link: mapping.calendar_event_link ? getValue(mapping.calendar_event_link) : null,
    work_order_pdf_link: mapping.work_order_pdf_link ? getValue(mapping.work_order_pdf_link) : null,
    signed_pdf_url: null,
    signed_preview_image_url: null,
    source: "external_import",
    last_updated_at: now,
  };

  return record;
}

/**
 * Transform multiple external rows into canonical records.
 * 
 * @param externalRows Array of row arrays from external sheet
 * @param externalHeaders Array of header names from external sheet
 * @param mapping Column mapping from external to canonical
 * @param issuerKey Issuer key for generating jobId (optional)
 * @returns Array of canonical records and any errors
 */
export function transformRows(
  externalRows: string[][],
  externalHeaders: string[],
  mapping: ImportMapping,
  issuerKey?: string
): { records: CanonicalWorkOrderRecord[]; errors: string[] } {
  const records: CanonicalWorkOrderRecord[] = [];
  const errors: string[] = [];

  externalRows.forEach((row, index) => {
    try {
      const record = transformRow(row, externalHeaders, mapping, issuerKey);
      records.push(record);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Row ${index + 2}: ${errorMessage}`); // +2 because row 1 is headers, and we're 0-indexed
    }
  });

  return { records, errors };
}

