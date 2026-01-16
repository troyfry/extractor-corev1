// lib/db/schema.ts
import {
  pgTable,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ============================================
// Workspaces & Members
// ============================================
export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  spreadsheet_id: text("spreadsheet_id"), // Nullable - only set if export_enabled=true
  drive_folder_id: text("drive_folder_id").notNull(), // Required - where PDFs are stored
  name: text("name"),
  primary_read_source: text("primary_read_source").default("DB"), // 'LEGACY' | 'DB' - default to DB for new workspaces
  // Gmail labels
  gmail_base_label_name: text("gmail_base_label_name"), // Base label name (e.g., "Work Orders")
  gmail_base_label_id: text("gmail_base_label_id"), // Base label ID
  gmail_queue_label_id: text("gmail_queue_label_id"), // Queue label ID (for work orders)
  gmail_signed_label_id: text("gmail_signed_label_id"), // Signed label ID
  gmail_processed_label_id: text("gmail_processed_label_id"), // Processed label ID (optional)
  // Onboarding & export
  onboarding_completed_at: timestamp("onboarding_completed_at", { withTimezone: true }),
  export_enabled: boolean("export_enabled").default(false), // Whether Sheets export is enabled
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const workspace_members = pgTable(
  "workspace_members",
  {
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull(),
    role: text("role").default("member"), // owner, admin, member
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspace_id, t.user_id] }),
    workspaceIdIdx: index("workspace_members_workspace_id_idx").on(
      t.workspace_id
    ),
    userIdIdx: index("workspace_members_user_id_idx").on(t.user_id),
  })
);

// ============================================
// FM Profiles
// ============================================
export const fm_profiles = pgTable(
  "fm_profiles",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fm_key: text("fm_key").notNull(),
    display_name: text("display_name"),
    sender_domains: jsonb("sender_domains"), // string[]
    sender_emails: jsonb("sender_emails"), // string[]
    wo_number_region: jsonb("wo_number_region"), // { page, xPt, yPt, wPt, hPt, ... }
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    workspaceFmKeyUnique: uniqueIndex("fm_profiles_workspace_fm_key_unique").on(
      t.workspace_id,
      t.fm_key
    ),
    workspaceIdIdx: index("fm_profiles_workspace_id_idx").on(t.workspace_id),
  })
);

// ============================================
// Work Orders (Canonical)
// ============================================
export const work_orders = pgTable(
  "work_orders",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    job_id: text("job_id").notNull(), // Generated job ID
    work_order_number: text("work_order_number"),
    fm_key: text("fm_key"), // FK to fm_profiles.fm_key (soft reference)

    // Core fields
    customer_name: text("customer_name"),
    service_address: text("service_address"),
    job_type: text("job_type"),
    job_description: text("job_description"),
    vendor_name: text("vendor_name"),
    scheduled_date: text("scheduled_date"),
    priority: text("priority"),

    // Financial
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: text("currency").default("USD"),
    nte_amount: numeric("nte_amount", { precision: 12, scale: 2 }),

    // Status & URLs
    status: text("status").default("OPEN"), // OPEN, SIGNED, CLOSED, etc.
    work_order_pdf_link: text("work_order_pdf_link"),
    signed_pdf_url: text("signed_pdf_url"),
    signed_preview_image_url: text("signed_preview_image_url"),
    signed_at: timestamp("signed_at", { withTimezone: true }),

    // Metadata
    notes: text("notes"),
    calendar_event_link: text("calendar_event_link"),

    // Timestamps
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    workspaceJobIdUnique: uniqueIndex("work_orders_workspace_job_id_unique").on(
      t.workspace_id,
      t.job_id
    ),
    workspaceWoNumberIdx: index("work_orders_workspace_wo_number_idx").on(
      t.workspace_id,
      t.work_order_number
    ),
    workspaceIdIdx: index("work_orders_workspace_id_idx").on(t.workspace_id),
  })
);

// ============================================
// Work Order Sources (Deduplication)
// ============================================
export const work_order_sources = pgTable(
  "work_order_sources",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    work_order_id: text("work_order_id")
      .notNull()
      .references(() => work_orders.id, { onDelete: "cascade" }),
    source_type: text("source_type").notNull(), // "GMAIL", "MANUAL_UPLOAD", "DRIVE"
    file_hash: text("file_hash").notNull(), // SHA-256 hash for deduplication
    source_metadata: jsonb("source_metadata"), // { messageId, attachmentId, filename, etc. }
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    fileHashUnique: uniqueIndex("work_order_sources_file_hash_unique").on(
      t.file_hash
    ),
    workspaceIdIdx: index("work_order_sources_workspace_id_idx").on(
      t.workspace_id
    ),
    workOrderIdIdx: index("work_order_sources_work_order_id_idx").on(
      t.work_order_id
    ),
  })
);

// ============================================
// Signed Documents
// ============================================
export const signed_documents = pgTable(
  "signed_documents",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    file_hash: text("file_hash").notNull(), // SHA-256 hash for deduplication
    signed_pdf_url: text("signed_pdf_url"), // Can be null if upload fails or not yet uploaded
    signed_preview_image_url: text("signed_preview_image_url"),
    fm_key: text("fm_key"), // Which FM profile was used for extraction
    extraction_method: text("extraction_method"), // DIGITAL_TEXT, OCR, AI_RESCUE
    extraction_confidence: numeric("extraction_confidence", {
      precision: 5,
      scale: 4,
    }), // 0.0000 to 1.0000
    extraction_rationale: text("extraction_rationale"),
    extracted_work_order_number: text("extracted_work_order_number"),
    source_metadata: jsonb("source_metadata"), // { messageId, attachmentId, gmailDate, etc. }
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    fileHashUnique: uniqueIndex("signed_documents_file_hash_unique").on(
      t.file_hash
    ),
    workspaceIdIdx: index("signed_documents_workspace_id_idx").on(
      t.workspace_id
    ),
  })
);

// ============================================
// Signed Match (1:1 enforcement)
// ============================================
export const signed_match = pgTable(
  "signed_match",
  {
    work_order_id: text("work_order_id")
      .primaryKey()
      .references(() => work_orders.id, { onDelete: "cascade" }),
    signed_document_id: text("signed_document_id")
      .notNull()
      .references(() => signed_documents.id, { onDelete: "cascade" }),
    matched_at: timestamp("matched_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    signedDocumentIdUnique: uniqueIndex(
      "signed_match_signed_document_id_unique"
    ).on(t.signed_document_id),
    workOrderIdIdx: index("signed_match_work_order_id_idx").on(
      t.work_order_id
    ),
  })
);

// ============================================
// Extraction Runs (Audit Trail)
// ============================================
export const extraction_runs = pgTable(
  "extraction_runs",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    work_order_id: text("work_order_id").references(() => work_orders.id, {
      onDelete: "set null",
    }),
    signed_document_id: text("signed_document_id").references(
      () => signed_documents.id,
      { onDelete: "set null" }
    ),
    extraction_type: text("extraction_type").notNull(), // "WORK_ORDER", "SIGNED_WO_NUMBER"
    pipeline_path: text("pipeline_path"), // DIGITAL_ONLY, OCR_ONLY, DIGITAL_OCR_AI, etc.
    wo_number_method: text("wo_number_method"), // CROPPED_OCR, FULL_TEXT_REGEX, AI_RESCUE, etc.
    wo_number_confidence: numeric("wo_number_confidence", {
      precision: 5,
      scale: 4,
    }),
    region_used: boolean("region_used").default(false),
    region_key: text("region_key"),
    input_scope: text("input_scope"), // CROPPED_REGION, FULL_TEXT
    cropped_text_snippet: text("cropped_text_snippet"),
    cropped_text_hash: text("cropped_text_hash"),
    reasons: jsonb("reasons"), // string[] - extraction reason codes
    candidates: jsonb("candidates"), // ExtractionCandidate[]
    debug: jsonb("debug"), // Record<string, unknown>
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    workspaceIdIdx: index("extraction_runs_workspace_id_idx").on(t.workspace_id),
    workOrderIdIdx: index("extraction_runs_work_order_id_idx").on(
      t.work_order_id
    ),
    createdAtIdx: index("extraction_runs_created_at_idx").on(t.created_at),
  })
);

// ============================================
// Export Jobs (Sheets Sync Queue)
// ============================================
export const export_jobs = pgTable(
  "export_jobs",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    job_type: text("job_type").notNull(), // "WORK_ORDER", "SIGNED_DOCUMENT", "SIGNED_MATCH"
    entity_id: text("entity_id").notNull(), // work_order_id or signed_document_id
    status: text("status").notNull().default("PENDING"), // PENDING, PROCESSING, DONE, FAILED
    error_code: text("error_code"), // "QUOTA_EXCEEDED", "NOT_FOUND", etc.
    error_message: text("error_message"),
    attempts: integer("attempts").default(0),
    next_retry_at: timestamp("next_retry_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    statusNextRetryIdx: index("export_jobs_status_next_retry_idx").on(
      t.status,
      t.next_retry_at
    ),
    workspaceIdIdx: index("export_jobs_workspace_id_idx").on(t.workspace_id),
    entityIdIdx: index("export_jobs_entity_id_idx").on(t.entity_id),
  })
);
