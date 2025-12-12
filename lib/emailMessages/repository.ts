/**
 * Repository interface for email messages.
 * This abstraction allows us to swap implementations without changing
 * the rest of the application.
 */
import { db } from "@/db/client";
import { emailMessages } from "@/db/schema";
import { desc, eq, lt } from "drizzle-orm";
import {
  EmailMessage,
  EmailMessageInput,
  EmailProcessingStatus,
} from "./types";
import { dbToEmailMessage, inputToDbInsert } from "./mappers";

export interface EmailMessageRepository {
  save(input: EmailMessageInput): Promise<EmailMessage>;
  insert(input: EmailMessageInput): Promise<EmailMessage>; // Alias for save
  listLatest(limit?: number): Promise<EmailMessage[]>;
  listNew(limit?: number): Promise<EmailMessage[]>; // List only "new" status emails
  listLatestAfter(
    cursor: Date,
    limit?: number
  ): Promise<EmailMessage[]>;
  getById(id: string): Promise<EmailMessage | null>;
  updateStatus(
    id: string,
    status: EmailProcessingStatus
  ): Promise<EmailMessage | null>;
  setDuplicateOf(
    id: string,
    workOrderId: string
  ): Promise<EmailMessage | null>;
  clear(): Promise<void>;
}

/**
 * Drizzle/Postgres implementation of EmailMessageRepository.
 */
class DrizzleEmailMessageRepository implements EmailMessageRepository {
  async save(input: EmailMessageInput): Promise<EmailMessage> {
    const insert = inputToDbInsert(input);
    const [row] = await db.insert(emailMessages).values(insert).returning();
    return dbToEmailMessage(row);
  }

  async insert(input: EmailMessageInput): Promise<EmailMessage> {
    // Alias for save - provides consistent naming with provider parsers
    return this.save(input);
  }

  async listLatest(limit = 50): Promise<EmailMessage[]> {
    const rows = await db
      .select()
      .from(emailMessages)
      .orderBy(desc(emailMessages.receivedAt))
      .limit(limit);

    return rows.map(dbToEmailMessage);
  }

  async listNew(limit = 50): Promise<EmailMessage[]> {
    // List only emails with status "new", sorted by receivedAt DESC
    const rows = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.processingStatus, "new"))
      .orderBy(desc(emailMessages.receivedAt))
      .limit(limit);

    return rows.map(dbToEmailMessage);
  }

  async listLatestAfter(
    cursor: Date,
    limit = 50
  ): Promise<EmailMessage[]> {
    const rows = await db
      .select()
      .from(emailMessages)
      .where(lt(emailMessages.receivedAt, cursor))
      .orderBy(desc(emailMessages.receivedAt))
      .limit(limit);

    return rows.map(dbToEmailMessage);
  }

  async getById(id: string): Promise<EmailMessage | null> {
    const [row] = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, id))
      .limit(1);

    return row ? dbToEmailMessage(row) : null;
  }

  async updateStatus(
    id: string,
    status: EmailProcessingStatus
  ): Promise<EmailMessage | null> {
    const [row] = await db
      .update(emailMessages)
      .set({
        processingStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, id))
      .returning();

    return row ? dbToEmailMessage(row) : null;
  }

  async setDuplicateOf(
    id: string,
    workOrderId: string
  ): Promise<EmailMessage | null> {
    const [row] = await db
      .update(emailMessages)
      .set({
        duplicateOfWorkOrderId: workOrderId,
        processingStatus: "skipped_duplicate",
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, id))
      .returning();

    return row ? dbToEmailMessage(row) : null;
  }

  async clear(): Promise<void> {
    await db.delete(emailMessages);
  }
}

/**
 * Singleton repository instance.
 */
export const emailMessageRepo: EmailMessageRepository =
  new DrizzleEmailMessageRepository();

