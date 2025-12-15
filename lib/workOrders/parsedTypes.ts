/**
 * Types for stateless parsed work orders (Manual upload flow).
 * 
 * These types are used for the Manual upload flow which does NOT persist
 * work orders to the database. Work orders exist only in memory during
 * the parsing session and are returned to the client for preview and CSV export.
 * 
 * NOTE: Manual upload is now a stateless converter (PDF -> WorkOrder[] -> CSV).
 * We intentionally do NOT persist work orders from this path.
 */

/**
 * Parsed work order from Manual PDF upload.
 * This is a simplified version without database-specific fields like id, userId, createdAt.
 */
export type ParsedWorkOrder = {
  workOrderNumber: string | null; // Can be null if not found - routes to "Needs Review" sheet
  scheduledDate: string | null;
  customerName: string | null;
  serviceAddress: string | null;
  jobType: string | null;
  jobDescription: string | null;
  amount: string | null;
  currency: string | null;
  notes: string | null;
  priority: string | null;
  vendorName: string | null;
  timestampExtracted: string; // ISO timestamp when extracted
  fmKey: string | null; // FM Profile key if matched, null otherwise
};

/**
 * Response from Manual PDF processing endpoint or Gmail processing endpoint.
 */
export type ManualProcessResponse = {
  workOrders: ParsedWorkOrder[];
  csv: string; // CSV string for download
  meta: {
    fileCount: number;
    processedAt: string; // ISO timestamp
    aiModel?: string; // AI model used if AI parsing was enabled
    source?: "manual" | "gmail"; // Source of the work orders
    messageId?: string; // Gmail message ID (if from Gmail)
    labelRemoved?: boolean; // Whether the Gmail label was removed (if from Gmail)
    warning?: string; // Warning message (non-fatal, e.g., missing spreadsheet ID in dev)
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
};

