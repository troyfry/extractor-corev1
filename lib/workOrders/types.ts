/**
 * Shared types for Work Orders across the application.
 * Used by both API routes and UI components.
 */

/**
 * Complete work order with all required fields.
 * Generated server-side: id and createdAt are always present.
 * userId is optional for free version - defaults to empty string if not provided.
 */
export type WorkOrder = {
  id: string;
  jobId: string; // Stable UUID for Google Sheets - never changes once created
  userId: string | null; // User ID from Google OAuth 'sub' claim (optional for free version)
  timestampExtracted: string; // ISO string
  workOrderNumber: string;
  fmKey: string | null; // FM Profile key
  status: string | null; // Work order status (OPEN, SIGNED, etc.)
  customerName: string | null;
  vendorName: string | null;
  serviceAddress: string | null;
  jobType: string | null;
  jobDescription: string | null;
  scheduledDate: string | null; // ISO string
  amount: string | null; // Decimal as string
  currency: string | null;
  notes: string | null;
  priority: string | null;
  calendarEventLink: string | null;
  workOrderPdfLink: string | null;
  signedPdfUrl: string | null; // Signed PDF URL
  signedPreviewImageUrl: string | null; // Signed preview image URL
  createdAt: string; // ISO string
};

/**
 * Input type for creating work orders.
 * id, timestampExtracted, and createdAt are optional (generated server-side if missing).
 * userId is optional for free version - defaults to empty string if not provided.
 */
export type WorkOrderInput = {
  id?: string;
  jobId?: string; // Optional: Stable UUID for Google Sheets (generated if not provided)
  userId?: string | null; // Optional: User ID from authenticated session (not needed for free version)
  timestampExtracted?: string; // ISO string
  workOrderNumber: string;
  customerName?: string | null;
  vendorName?: string | null;
  serviceAddress?: string | null;
  jobType?: string | null;
  jobDescription?: string | null;
  scheduledDate?: string | null; // ISO string
  amount?: string | null; // Decimal as string
  currency?: string | null;
  notes?: string | null;
  priority?: string | null;
  calendarEventLink?: string | null;
  workOrderPdfLink?: string | null;
  createdAt?: string; // ISO string
};

