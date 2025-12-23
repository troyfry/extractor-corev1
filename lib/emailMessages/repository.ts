/**
 * Repository interface for email messages.
 * 
 * NOTE: Email messages are no longer stored in a database.
 * This is a stub implementation for backward compatibility.
 */

import { randomUUID } from "crypto";
import type {
  EmailMessage,
  EmailMessageInput,
  EmailProcessingStatus,
} from "./types";

export interface EmailMessageRepository {
  save(input: EmailMessageInput): Promise<EmailMessage>;
  insert(input: EmailMessageInput): Promise<EmailMessage>;
  listLatest(limit?: number): Promise<EmailMessage[]>;
  listNew(limit?: number): Promise<EmailMessage[]>;
  listLatestAfter(cursor: Date, limit?: number): Promise<EmailMessage[]>;
  getById(id: string): Promise<EmailMessage | null>;
  updateStatus(id: string, status: EmailProcessingStatus): Promise<EmailMessage | null>;
  setDuplicateOf(id: string, workOrderId: string): Promise<EmailMessage | null>;
  clear(): Promise<void>;
}

/**
 * Stub implementation - email messages are no longer stored in DB.
 */
class StubEmailMessageRepository implements EmailMessageRepository {
  async save(input: EmailMessageInput): Promise<EmailMessage> {
    console.warn("[emailMessageRepo] save() called but email messages are no longer stored in DB");
    // Return a stub email message
    // Generate ID since EmailMessageInput doesn't include it
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      provider: input.provider || "generic",
      externalId: input.providerMessageId || input.externalId || null,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      subject: input.subject,
      receivedAt: input.receivedAt,
      processingStatus: (input.status || "new") as EmailProcessingStatus,
      hasPdfAttachments: input.attachments.some(a => a.mimeType?.toLowerCase().includes("pdf")),
      pdfAttachmentCount: input.attachments.filter(a => a.mimeType?.toLowerCase().includes("pdf")).length,
      attachments: input.attachments,
      duplicateOfWorkOrderId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async insert(input: EmailMessageInput): Promise<EmailMessage> {
    return this.save(input);
  }

  async listLatest(limit = 50): Promise<EmailMessage[]> {
    console.warn("[emailMessageRepo] listLatest() called but email messages are no longer stored in DB");
    return [];
  }

  async listNew(limit = 50): Promise<EmailMessage[]> {
    console.warn("[emailMessageRepo] listNew() called but email messages are no longer stored in DB");
    return [];
  }

  async listLatestAfter(cursor: Date, limit = 50): Promise<EmailMessage[]> {
    console.warn("[emailMessageRepo] listLatestAfter() called but email messages are no longer stored in DB");
    return [];
  }

  async getById(id: string): Promise<EmailMessage | null> {
    console.warn("[emailMessageRepo] getById() called but email messages are no longer stored in DB");
    return null;
  }

  async updateStatus(id: string, status: EmailProcessingStatus): Promise<EmailMessage | null> {
    console.warn("[emailMessageRepo] updateStatus() called but email messages are no longer stored in DB");
    return null;
  }

  async setDuplicateOf(id: string, workOrderId: string): Promise<EmailMessage | null> {
    console.warn("[emailMessageRepo] setDuplicateOf() called but email messages are no longer stored in DB");
    return null;
  }

  async clear(): Promise<void> {
    console.warn("[emailMessageRepo] clear() called but email messages are no longer stored in DB");
  }
}

export const emailMessageRepo: EmailMessageRepository = new StubEmailMessageRepository();

