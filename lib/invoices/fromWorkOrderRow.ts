import type { WorkOrderRecord } from "@/lib/google/sheets";
import type {
  InvoiceDraft,
  InvoiceLineItem,
  Address,
  InvoiceAttachments,
  InvoiceSourceMeta,
} from "./invoiceTypes";

/**
 * Converts a WorkOrderRecord to an InvoiceDraft.
 * 
 * This is the ONLY place that translates "work order row → invoice."
 * This is a pure mapping function with no PDF rendering or Drive writing.
 * 
 * Mapping rules:
 * - wo_number → workOrderNumber
 * - scheduled_date → scheduledDate
 * - customer_name → billTo.name
 * - service_address → serviceAddress
 * - job_type → jobType
 * - job_description → jobDescription
 * - amount → amount (parsed to number)
 * - currency → currency (default if empty)
 * - notes/priority → notes (optional)
 * - work_order_pdf_link → attachments.workOrderPdfUrl
 * - signed_pdf_url → attachments.signedPdfUrl
 * - fmKey/jobId → sourceMeta
 * 
 * @param workOrder - The work order record from Google Sheets
 * @returns An InvoiceDraft with mapped fields from the work order
 */
export function workOrderToInvoiceDraft(
  workOrder: WorkOrderRecord
): InvoiceDraft {
  // Map customer_name → billTo.name
  const billTo: Address = {
    name: workOrder.customer_name || "Customer",
    // Address parsing could be added here if customer_name contains full address
  };

  // Map job_description and amount → lineItems
  const lineItems: InvoiceLineItem[] = [];
  
  if (workOrder.job_description || workOrder.amount) {
    const amount = workOrder.amount ? parseFloat(workOrder.amount) : 0;
    const lineItem: InvoiceLineItem = {
      description: workOrder.job_description || "Service",
      quantity: 1,
      rate: amount,
      amount: amount,
    };
    lineItems.push(lineItem);
  }

  // Map work_order_pdf_link → attachments.workOrderPdfUrl
  // Map signed_pdf_url → attachments.signedPdfUrl
  const attachments: InvoiceAttachments = {
    workOrderPdfUrl: workOrder.work_order_pdf_link || null,
    signedPdfUrl: workOrder.signed_pdf_url || null,
  };

  // Map fmKey/jobId → sourceMeta
  const sourceMeta: InvoiceSourceMeta = {
    userId: workOrder.fmKey || null, // fmKey may represent user_id
    jobId: workOrder.jobId,
  };

  // Use created_at as invoice date, or current date if not available
  const invoiceDate = workOrder.created_at 
    ? new Date(workOrder.created_at).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  // Generate invoice number from work order number and date
  const invoiceNumber = `INV-${workOrder.wo_number}-${invoiceDate.replace(/-/g, '')}`;

  // Calculate subtotal from line items
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);

  // Map amount → amount (parse to number)
  const amount = workOrder.amount ? parseFloat(workOrder.amount) : null;

  // Map currency → currency (default if empty)
  const currency = workOrder.currency || "USD";

  // Map notes/priority → notes (combine if both exist)
  const notes = workOrder.notes 
    ? workOrder.priority 
      ? `${workOrder.notes} (Priority: ${workOrder.priority})`
      : workOrder.notes
    : workOrder.priority || null;

  return {
    invoiceNumber,
    invoiceDate,
    billTo,
    serviceAddress: workOrder.service_address || null,
    lineItems,
    subtotal,
    // tax and total can be computed later
    workOrderNumbers: [workOrder.wo_number],
    attachments,
    notes,
    terms: null, // Terms not in work order, can be set later
    dueDate: null, // Due date not in work order, can be computed from invoiceDate + terms
    // Direct mappings from work order
    workOrderNumber: workOrder.wo_number,
    scheduledDate: workOrder.scheduled_date || null,
    jobType: workOrder.job_type || null,
    jobDescription: workOrder.job_description || null,
    amount,
    currency,
    sourceMeta,
  };
}

