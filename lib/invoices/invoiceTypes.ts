/**
 * Invoice draft type for creating invoices from work orders.
 * This represents a draft invoice that can be edited before finalization.
 */

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  rate: number; // Price per unit
  amount: number; // quantity * rate (can be computed or overridden)
};

export type Address = {
  name: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
};

export type InvoiceAttachments = {
  workOrderPdfUrl: string | null;
  signedPdfUrl: string | null;
};

export type InvoiceSourceMeta = {
  userId: string | null; // From fmKey or user_id field
  jobId: string; // From jobId field
};

export type InvoiceDraft = {
  invoiceNumber: string;
  invoiceDate: string; // ISO date string
  billTo: Address; // Customer billing address
  serviceAddress: string | null; // Job site/service location
  lineItems: InvoiceLineItem[];
  subtotal?: number; // Sum of line item amounts (can be computed)
  tax?: number; // Tax amount (optional, can be computed later)
  total?: number; // subtotal + tax (can be computed later)
  workOrderNumbers: string[]; // Associated work order numbers
  attachments: InvoiceAttachments; // PDF attachment URLs
  notes: string | null;
  terms: string | null; // Payment terms
  dueDate: string | null; // ISO date string
  // Direct mappings from work order
  workOrderNumber: string;
  scheduledDate: string | null; // ISO date string
  jobType: string | null;
  jobDescription: string | null;
  amount: number | null; // Parsed amount as number
  currency: string | null; // Currency code (default if empty)
  sourceMeta: InvoiceSourceMeta; // Source metadata (userId, jobId)
};

