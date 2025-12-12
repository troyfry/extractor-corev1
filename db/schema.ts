/**
 * Drizzle schema definitions for the database.
 * 
 * This file defines all database tables using Drizzle ORM.
 * Each table maps to a TypeScript type that can be inferred.
 * 
 * Architecture:
 * - DB schema (this file) represents the database structure
 * - lib/workOrders/types.ts defines the API/UI shape (WorkOrder, WorkOrderInput)
 * - lib/workOrders/mappers.ts handles conversion between DB and API shapes
 */
import { pgTable, uuid, varchar, timestamp, decimal, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

/**
 * Work Orders table.
 * Maps to the WorkOrder type in lib/workOrders/types.ts
 */

export const workOrders = pgTable("work_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 }), // User ID from Google OAuth 'sub' claim (optional for free version)
  timestampExtracted: timestamp("timestamp_extracted", { withTimezone: false }).defaultNow().notNull(),
  workOrderNumber: varchar("work_order_number", { length: 255 }).notNull(),
  customerName: varchar("customer_name", { length: 255 }),
  vendorName: varchar("vendor_name", { length: 255 }),
  serviceAddress: varchar("service_address", { length: 500 }),
  jobType: varchar("job_type", { length: 255 }),
  jobDescription: varchar("job_description", { length: 1000 }),
  scheduledDate: timestamp("scheduled_date", { withTimezone: false }),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  notes: varchar("notes", { length: 2000 }),
  priority: varchar("priority", { length: 50 }),
  calendarEventLink: varchar("calendar_event_link", { length: 500 }),
  workOrderPdfLink: varchar("work_order_pdf_link", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: false }).defaultNow().notNull(),
});

// Export inferred types for use in repository and mappers
export type DBWorkOrder = InferSelectModel<typeof workOrders>;
export type DBWorkOrderInsert = InferInsertModel<typeof workOrders>;

/**
 * Email Messages table.
 * Stores emails received via inbound email gateway (provider-agnostic).
 */
export const emailMessages = pgTable("email_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: varchar("provider", { length: 50 }).notNull().default("generic"),
  externalId: varchar("external_id", { length: 255 }),
  fromAddress: varchar("from_address", { length: 255 }).notNull(),
  toAddress: varchar("to_address", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: false }).notNull(),
  processingStatus: varchar("processing_status", { length: 50 })
    .notNull()
    .default("new"),
  hasPdfAttachments: boolean("has_pdf_attachments").notNull().default(false),
  pdfAttachmentCount: integer("pdf_attachment_count").notNull().default(0),
  attachments: jsonb("attachments").notNull().default("[]"), // stores EmailAttachment[]
  duplicateOfWorkOrderId: uuid("duplicate_of_work_order_id"),
  createdAt: timestamp("created_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false })
    .notNull()
    .defaultNow(),
});

export type DBEmailMessage = InferSelectModel<typeof emailMessages>;
export type DBEmailMessageInsert = InferInsertModel<typeof emailMessages>;

/**
 * Free tier usage tracking tables for rate limiting.
 * 
 * These tables track usage to prevent abuse of the free tier:
 * - free_usage_daily: Per-IP daily document count
 * - free_usage_monthly: Per-IP monthly document count
 * - free_usage_global: Global monthly document count (safety fuse)
 */
export const freeUsageDaily = pgTable("free_usage_daily", {
  ipHash: varchar("ip_hash", { length: 255 }).notNull(),
  dayKey: varchar("day_key", { length: 10 }).notNull(), // YYYY-MM-DD
  count: integer("count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  pk: { primaryKey: { columns: [table.ipHash, table.dayKey] } },
}));

export const freeUsageMonthly = pgTable("free_usage_monthly", {
  ipHash: varchar("ip_hash", { length: 255 }).notNull(),
  monthKey: varchar("month_key", { length: 7 }).notNull(), // YYYY-MM
  count: integer("count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow().notNull(),
}, (table) => ({
  pk: { primaryKey: { columns: [table.ipHash, table.monthKey] } },
}));

export const freeUsageGlobal = pgTable("free_usage_global", {
  monthKey: varchar("month_key", { length: 7 }).notNull().primaryKey(), // YYYY-MM
  count: integer("count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: false }).defaultNow().notNull(),
});

