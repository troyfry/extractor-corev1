/**
 * Import types for external spreadsheet import.
 * 
 * External sheets are READ-ONLY. We only read from them and import into our internal sheet.
 */

/**
 * Canonical work order record format (matches our internal Work_Orders sheet).
 * This is what we transform external data into.
 */
export type CanonicalWorkOrderRecord = {
  jobId: string; // Generated: issuerKey:wo_number
  fmKey: string | null;
  wo_number: string; // Required - used for deduplication
  status: string;
  scheduled_date: string | null;
  created_at: string; // ISO timestamp
  timestamp_extracted: string; // ISO timestamp
  customer_name: string | null;
  vendor_name: string | null;
  service_address: string | null;
  job_type: string | null;
  job_description: string | null;
  amount: string | null;
  currency: string | null;
  notes: string | null;
  priority: string | null;
  calendar_event_link: string | null;
  work_order_pdf_link: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
  source: string; // "external_import"
  last_updated_at: string; // ISO timestamp
  file_hash?: string | null;
};

/**
 * Column mapping from external sheet to canonical format.
 * Maps external column names (as they appear in the external sheet) to canonical field names.
 */
export type ImportMapping = {
  // Required mappings
  wo_number: string; // External column name for work order number (required)
  
  // Optional mappings (can be empty string if not available)
  fmKey?: string;
  status?: string;
  scheduled_date?: string;
  customer_name?: string;
  vendor_name?: string;
  service_address?: string;
  job_type?: string;
  job_description?: string;
  amount?: string;
  currency?: string;
  notes?: string;
  priority?: string;
  calendar_event_link?: string;
  work_order_pdf_link?: string;
};

/**
 * Deduplication result for a record.
 */
export type DedupeResult = {
  status: "new" | "duplicate" | "conflict";
  existingJobId?: string;
  existingRecord?: Partial<CanonicalWorkOrderRecord>;
  conflictReason?: string;
};

/**
 * Import preview result.
 */
export type ImportPreview = {
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  conflictCount: number;
  sampleRows: Array<{
    externalRow: Record<string, string>;
    canonical: CanonicalWorkOrderRecord;
    dedupe: DedupeResult;
  }>;
  errors: string[];
};

