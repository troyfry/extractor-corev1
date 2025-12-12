/**
 * Mapper functions to convert between database models and API/UI types.
 * 
 * The database uses Date objects for timestamps, while the API/UI layer
 * uses ISO string representations for dates.
 */
import type { DBEmailMessage, DBEmailMessageInsert } from "@/db/schema";
import type {
  EmailMessage,
  EmailMessageInput,
  EmailAttachment,
  EmailProcessingStatus,
} from "./types";

/**
 * Convert a database email message row to the API/UI EmailMessage type.
 * Converts Date fields to ISO strings.
 */
export function dbToEmailMessage(row: DBEmailMessage): EmailMessage {
  const attachments = (row.attachments ?? []) as EmailAttachment[];

  return {
    id: row.id,
    provider: (row.provider as any) ?? "generic",
    externalId: row.externalId ?? null,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    subject: row.subject,
    receivedAt: row.receivedAt.toISOString(),
    processingStatus: row.processingStatus as EmailProcessingStatus,
    hasPdfAttachments: row.hasPdfAttachments ?? false,
    pdfAttachmentCount: row.pdfAttachmentCount ?? 0,
    attachments,
    duplicateOfWorkOrderId: row.duplicateOfWorkOrderId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Convert an EmailMessageInput to a database insert type.
 * Converts ISO string dates to Date objects for database insertion.
 * Maps providerMessageId to externalId and status to processingStatus.
 */
export function inputToDbInsert(
  input: EmailMessageInput
): DBEmailMessageInsert {
  const provider = input.provider ?? "generic";
  
  // Map providerMessageId to externalId (support both field names)
  const externalId = input.providerMessageId ?? input.externalId ?? null;
  
  // Map status to processingStatus (default to "new")
  let processingStatus: "new" | "processed" | "skipped_duplicate" = "new";
  if (input.status) {
    if (input.status === "processed") {
      processingStatus = "processed";
    } else if (input.status === "skipped_duplicate") {
      processingStatus = "skipped_duplicate";
    } else if (input.status === "new") {
      processingStatus = "new";
    }
    // "error" and "archived" map to "new" for now (can be extended later)
  }

  const pdfAttachments = input.attachments.filter((a) =>
    (a.mimeType || "").toLowerCase().includes("pdf")
  );

  return {
    provider,
    externalId,
    fromAddress: input.fromAddress,
    toAddress: input.toAddress,
    subject: input.subject,
    receivedAt: new Date(input.receivedAt),
    processingStatus,
    hasPdfAttachments: pdfAttachments.length > 0,
    pdfAttachmentCount: pdfAttachments.length,
    attachments: input.attachments,
    // duplicateOfWorkOrderId left null for now
  };
}

