# Onboarding DB-Native Migration

## Overview

Onboarding has been converted to be DB-native, removing the dependency on Google Sheets. Sheets is now optional and used only for export purposes.

## Key Changes

### 1. Database Schema Updates

**File**: `lib/db/schema.ts`

The `workspaces` table has been updated:

**Before**:
- `spreadsheet_id`: `notNull()` (required)
- `drive_folder_id`: nullable
- `primary_read_source`: default `"LEGACY"`

**After**:
- `spreadsheet_id`: nullable (only set if `export_enabled=true`)
- `drive_folder_id`: `notNull()` (required - where PDFs are stored)
- `primary_read_source`: default `"DB"` (new workspaces default to DB)
- **New fields**:
  - `gmail_base_label_name`: Base Gmail label name
  - `gmail_base_label_id`: Base Gmail label ID
  - `gmail_queue_label_id`: Queue label ID (for work orders)
  - `gmail_signed_label_id`: Signed label ID
  - `gmail_processed_label_id`: Processed label ID (optional)
  - `onboarding_completed_at`: Timestamp when onboarding completed
  - `export_enabled`: Boolean flag (default `false`)

### 2. Workspace Service Updates

**File**: `lib/db/services/workspace.ts`

**`getOrCreateWorkspace()` signature changed**:
- **Old**: `getOrCreateWorkspace(spreadsheetId, userId, driveFolderId?)`
- **New**: `getOrCreateWorkspace(driveFolderId, userId, spreadsheetId?, workspaceName?)`

**New functions**:
- `getWorkspaceById(workspaceId)`: Get workspace by ID
- `getWorkspaceIdByUserId(userId)`: Get workspace ID for a user
- `updateWorkspaceConfig(workspaceId, config)`: Update workspace config (Gmail labels, onboarding completion, etc.)

### 3. Onboarding Google Endpoint

**File**: `app/api/onboarding/google/route.ts`

**Changes**:
- **Spreadsheet creation is now OPTIONAL**: Only created if `enableExport=true` in request body
- **Drive folder is REQUIRED**: Always created/found
- **DB storage**: Workspace is created/updated in DB with drive folder info
- **Cookies**: Sets `workspaceId` cookie (DB-native) instead of just `spreadsheetId`

**Request Body**:
```json
{
  "folderName": "Work Orders",  // Required
  "sheetName": "Work Order Workspace",  // Optional - only required if enableExport=true
  "enableExport": false  // Optional - defaults to false
}
```

**Response**:
```json
{
  "folderId": "...",
  "spreadsheetId": "..." | null,  // null if export disabled
  "folderUrl": "...",
  "sheetUrl": "..." | null,  // null if export disabled
  "workspaceId": "...",  // DB workspace ID
  "exportEnabled": false
}
```

### 4. Onboarding Complete Endpoint

**File**: `app/api/onboarding/complete/route.ts`

**Changes**:
- **Removed**: `completeOnboarding()` call (no longer writes to Users sheet)
- **Removed**: `saveWorkspaceConfig()` call (no longer writes to Users sheet)
- **Added**: `updateWorkspaceConfig()` call (writes to DB)
- **FM Profiles & Templates**: Only fetched if `export_enabled=true` (optional)
- **Gmail Labels**: Still created and stored in DB

**Request Body**:
```json
{
  "gmailWorkOrdersLabelName": "Work Orders",  // Optional
  "gmailSignedLabelName": "Signed Work Orders",  // Optional
  "gmailProcessedLabelName": "Processed"  // Optional
}
```

### 5. Onboarding Status Endpoint

**File**: `app/api/onboarding/status/route.ts`

**Changes**:
- **Removed**: All Sheets API calls
- **Removed**: Quota cooldown logic (no longer needed)
- **DB-first**: Checks `onboarding_completed_at` in workspace config
- **Cookie-first**: Still checks `onboardingCompleted` cookie first (fast path)

**Response**:
```json
{
  "onboardingCompleted": boolean,
  "isAuthenticated": boolean
}
```

### 6. Workspace ID Lookup

**File**: `lib/db/utils/getWorkspaceId.ts`

**Changes**:
- **DB-native**: Uses `workspaceId` cookie first
- **Fallback**: Looks up by user ID
- **Legacy support**: Falls back to spreadsheet ID lookup for backward compatibility

### 7. Cookie Rehydration

**File**: `lib/workspace/workspaceCookies.ts`

**Changes**:
- **Updated `rehydrateWorkspaceCookies()`**: Now accepts DB workspace format
- **DB workspace format**: Detects `id` and `drive_folder_id` fields
- **Sets `workspaceId` cookie**: DB-native workspace ID
- **Version validation**: Updated comment to mention "DB workspace config" instead of "Users Sheet"

### 8. Shadow Writes

**Files**: 
- `app/api/gmail/process/route.ts`
- `app/api/signed/process/route.ts`
- `app/api/signed/process-gmail/route.ts`

**Changes**:
- **Updated**: Use `getWorkspaceIdForUser()` instead of `getOrCreateWorkspace()`
- **Graceful handling**: If workspace ID not found, logs warning and continues (non-blocking)

## Migration Steps

### Database Migration

Run a migration to update the `workspaces` table:

```sql
-- Make spreadsheet_id nullable
ALTER TABLE workspaces ALTER COLUMN spreadsheet_id DROP NOT NULL;

-- Make drive_folder_id required (if not already)
ALTER TABLE workspaces ALTER COLUMN drive_folder_id SET NOT NULL;

-- Add new columns
ALTER TABLE workspaces 
  ADD COLUMN IF NOT EXISTS gmail_base_label_name TEXT,
  ADD COLUMN IF NOT EXISTS gmail_base_label_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_queue_label_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_signed_label_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_processed_label_id TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS export_enabled BOOLEAN DEFAULT false;

-- Update default for primary_read_source
ALTER TABLE workspaces ALTER COLUMN primary_read_source SET DEFAULT 'DB';

-- For existing workspaces, set export_enabled=true if they have a spreadsheet_id
UPDATE workspaces SET export_enabled = true WHERE spreadsheet_id IS NOT NULL;
```

### Backward Compatibility

The system maintains backward compatibility:

1. **Existing workspaces**: Workspaces created before this change will continue to work
2. **Spreadsheet ID lookup**: `getWorkspaceIdBySpreadsheetId()` still works for legacy lookups
3. **Cookie fallback**: System falls back to spreadsheet ID cookies if workspace ID not found

## Acceptance Criteria

✅ **A new user can complete onboarding without creating a spreadsheet**
- Drive folder is created
- Workspace is stored in DB
- Onboarding completes successfully

✅ **Work orders + signed flows function DB-first**
- All ingestion writes to DB
- Workspace lookup uses DB-first approach
- Sheets writes are non-blocking (export jobs)

✅ **Sheets is only required if export_enabled=true**
- Spreadsheet creation is optional
- Export failures never block core actions
- Export jobs handle Sheets quota errors gracefully

✅ **No onboarding route requires Users sheet**
- `/api/onboarding/google`: Creates workspace in DB
- `/api/onboarding/complete`: Stores config in DB
- `/api/onboarding/status`: Checks DB workspace config

## Testing Checklist

- [ ] New user can complete onboarding without spreadsheet
- [ ] Workspace is created in DB with drive folder ID
- [ ] Onboarding status check works without Sheets
- [ ] Gmail labels are created and stored in DB
- [ ] Cookies are set correctly (workspaceId, drive folder, etc.)
- [ ] Work order ingestion works with DB-native workspace
- [ ] Signed document processing works with DB-native workspace
- [ ] Export jobs work when export_enabled=true
- [ ] Export failures don't block core actions

## Rollout Strategy

1. **Deploy schema migration** (make spreadsheet_id nullable, add new fields)
2. **Deploy code changes** (DB-native onboarding endpoints)
3. **Test with new users** (verify onboarding works without Sheets)
4. **Monitor export jobs** (ensure Sheets export still works when enabled)
5. **Gradual migration** (existing users continue with Sheets until migrated)

## Notes

- **Drive folder is REQUIRED**: All workspaces must have a drive folder for PDF storage
- **Spreadsheet is OPTIONAL**: Only needed if user wants Sheets export
- **DB is source of truth**: All workspace config is stored in DB
- **Cookies are hints**: Fast access, but DB is authoritative
- **Backward compatible**: Existing workspaces continue to work
