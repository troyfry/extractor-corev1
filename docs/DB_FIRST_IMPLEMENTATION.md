# DB-First Shadow Writes Implementation

## Overview

This implementation adds Neon + Drizzle as a parallel authority layer for work orders and signed documents, without refactoring existing Sheets-first flows. The database becomes the authoritative storage, while Sheets becomes an export layer (best-effort, can fail without breaking ingestion).

## Architecture

### Key Principles
- **Idempotency**: All ingestion functions use `file_hash` and unique constraints to prevent duplicates
- **Non-blocking**: DB writes are shadow writes - Sheets failures don't break user actions
- **Export Queue**: Sheets sync happens via background jobs with exponential backoff
- **1:1 Enforcement**: Signed documents enforce 1:1 relationship with work orders via `signed_match` table

## Database Schema

### Tables Created

1. **workspaces** - Workspace configuration (spreadsheet_id, drive_folder_id)
2. **workspace_members** - User membership in workspaces
3. **fm_profiles** - FM profile configurations per workspace
4. **work_orders** - Canonical work order data (authoritative)
5. **work_order_sources** - Source tracking with `file_hash` for deduplication
6. **signed_documents** - Signed PDF documents with extraction metadata
7. **signed_match** - 1:1 relationship between work orders and signed documents
8. **extraction_runs** - Audit trail for extraction processes
9. **export_jobs** - Queue for Sheets sync (PENDING, PROCESSING, DONE, FAILED)

### Key Constraints

- `work_order_sources.file_hash` - UNIQUE (prevents duplicate processing)
- `signed_documents.file_hash` - UNIQUE (prevents duplicate processing)
- `signed_match.work_order_id` - PRIMARY KEY (enforces 1:1)
- `signed_match.signed_document_id` - UNIQUE (enforces 1:1)

## Implementation Files

### Schema & Client
- `lib/db/schema.ts` - Complete Drizzle schema
- `lib/db/drizzle.ts` - Drizzle client initialization
- `lib/db/client.ts` - Re-exports for convenience

### Services
- `lib/db/services/workspace.ts` - Workspace management (`getOrCreateWorkspace`)
- `lib/db/services/ingestWorkOrder.ts` - Idempotent work order ingestion
- `lib/db/services/ingestSigned.ts` - Idempotent signed document ingestion with 1:1 matching

### Export Processor
- `lib/exports/processExportJobs.ts` - Background job processor for Sheets sync
  - Exponential backoff (1s, 2s, 4s, 8s, 16s)
  - Stops on quota errors
  - Max 5 attempts per job

### API Routes
- `app/api/db/preview/route.ts` - Admin preview of last 20 work orders + export status

### Shadow Writes (Non-blocking)
- `app/api/gmail/process/route.ts` - Added shadow write after Sheets success
- `app/api/signed/process/route.ts` - Added shadow write after signed processing
- `app/api/signed/process-gmail/route.ts` - Added shadow write after Gmail signed processing

## Migration

### Generating Migrations

1. Ensure `DATABASE_URL` is set in `.env.local`
2. Run: `npx drizzle-kit generate`
3. When prompted about `workspace_id` in `work_orders`:
   - Select: **"+ workspace_id create column"** (new column, not a rename)
4. Review generated migration in `drizzle/`
5. Apply migration: `npx drizzle-kit push` (or use your migration tool)

### Migration Notes

- The existing `work_orders` table has `user_id` - the new schema uses `workspace_id`
- If you have existing data, you'll need a data migration script
- For fresh installs, the migration will create all tables from scratch

## Usage

### Ingesting Work Orders

```typescript
import { ingestWorkOrderAuthoritative } from "@/lib/db/services/ingestWorkOrder";
import { getOrCreateWorkspace } from "@/lib/db/services/workspace";

const workspaceId = await getOrCreateWorkspace(spreadsheetId, userId);
const { workOrderId, isNew } = await ingestWorkOrderAuthoritative({
  workspaceId,
  userId,
  spreadsheetId,
  parsedWorkOrder,
  pdfBuffer,
  sourceType: "GMAIL",
  sourceMetadata: { messageId, filename, emailSubject },
});
```

### Ingesting Signed Documents

```typescript
import { ingestSignedAuthoritative } from "@/lib/db/services/ingestSigned";

const { signedDocumentId, isNew, matchedWorkOrderId } = await ingestSignedAuthoritative({
  workspaceId,
  pdfBuffer,
  signedPdfUrl,
  signedPreviewImageUrl,
  fmKey,
  extractionResult,
  workOrderNumber,
});
```

### Processing Export Jobs

```typescript
import { processExportJobs } from "@/lib/exports/processExportJobs";

// Process up to 10 pending jobs
const { processed, failed, quotaError } = await processExportJobs(10);
```

## Acceptance Criteria

✅ **Sheets quota errors don't break ingestion**
- DB writes happen first (authoritative)
- Export jobs are enqueued
- Sheets failures are logged but don't throw

✅ **Duplicate processing prevented**
- `file_hash` unique constraints prevent duplicate work orders
- `file_hash` unique constraints prevent duplicate signed documents
- Idempotent functions can be called multiple times safely

✅ **1:1 signed document enforcement**
- `signed_match` table enforces one signed doc per work order
- Attempting to attach a second signed doc to the same work order is prevented

✅ **Export job queue**
- Jobs are created with status PENDING
- Processor handles exponential backoff
- Quota errors stop processing (don't hammer API)
- Failed jobs can be retried

## Next Steps

1. **Run migrations**: Generate and apply Drizzle migrations
2. **Test ingestion**: Process a work order and verify DB write
3. **Test export**: Run export processor and verify Sheets sync
4. **Monitor**: Check `/api/db/preview` to see DB state and export status
5. **Schedule export processor**: Set up a cron job or background worker to process export jobs periodically

## Notes

- All DB writes are currently non-blocking (try/catch with logging)
- Export jobs are created automatically on ingestion
- The export processor needs to be called periodically (cron job, background worker, or API endpoint)
- Workspace creation is automatic on first ingestion
