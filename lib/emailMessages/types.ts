/**
 * Types for Email Messages across the application.
 * Used by both API routes and UI components.
 */

export type EmailProcessingStatus = "new" | "processed" | "skipped_duplicate";

// Extended status type for future use (includes error, archived)
export type EmailStatus = "new" | "processed" | "error" | "archived" | "skipped_duplicate";

export type EmailProvider = "generic" | "test" | "mailgun" | "ses" | "postmark";

export type EmailAttachment = {
  id: string; // stable id inside our system
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  // For PDFs, this should hold either:
  // - a local filesystem path (e.g., /var/app/uploads/email-attachments/1234.pdf), or
  // - an HTTP/HTTPS URL pointing to the file (e.g., S3 or object storage)
  storageLocation: string | null;
};

/**
 * Complete email message with all required fields.
 * Generated server-side: id, createdAt, updatedAt are always present.
 * 
 * Note: The database uses `processingStatus` and `externalId`, but we also support
 * `status` and `providerMessageId` as aliases for compatibility with provider parsers.
 */
export type EmailMessage = {
  id: string;
  provider: EmailProvider;
  externalId: string | null; // id from SES/Mailgun/etc if available (maps to providerMessageId)
  fromAddress: string;
  toAddress: string;
  subject: string;
  receivedAt: string; // ISO string
  processingStatus: EmailProcessingStatus; // Maps to status in provider parsers
  hasPdfAttachments: boolean;
  pdfAttachmentCount: number;
  attachments: EmailAttachment[]; // all attachments, not just PDFs
  // duplicate info (for later when WorkOrder de-dupe is real):
  duplicateOfWorkOrderId?: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

/**
 * Input type for creating email messages (from inbound API).
 * id, createdAt, updatedAt are optional (generated server-side if missing).
 * 
 * Supports both `providerMessageId` (from parsers) and `externalId` (for DB compatibility).
 */
export type EmailMessageInput = {
  provider?: EmailProvider; // default "generic"
  providerMessageId?: string; // Provider-specific message ID (maps to externalId in DB)
  externalId?: string | null; // Alternative name for providerMessageId (for compatibility)
  fromAddress: string;
  toAddress: string;
  subject: string;
  receivedAt: string; // ISO
  status?: EmailStatus; // Maps to processingStatus in DB (defaults to "new")
  attachments: EmailAttachment[];
};

