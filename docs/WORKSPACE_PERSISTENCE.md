# Workspace Persistence Architecture

## Overview

The workspace persistence system ensures users only complete onboarding once. Workspace configuration is stored in Google Sheets (Users sheet) as the source of truth, with cookies providing a fast access path to avoid quota issues.

## Architecture

### Persistence Layers (Priority Order)

1. **Cookies** (Fast path, zero API calls)
   - `workspaceReady=true` - Primary indicator
   - `workspaceSpreadsheetId` - Optional cache hint
   - `workspaceDriveFolderId` - Optional cache hint
   - `onboardingCompletedAt` - Timestamp

2. **Users Sheet** (Source of truth)
   - `spreadsheet_id` - Workspace spreadsheet ID
   - `drive_folder_id` - Drive folder ID
   - `fm_profiles_json` - JSON array of normalized fmKeys
   - `templates_configured` - "TRUE" or "FALSE"
   - `onboarding_completed_at` - ISO timestamp

### WorkspaceConfig Contract

```typescript
type WorkspaceConfig = {
  spreadsheetId: string;
  driveFolderId: string;
  fmProfiles: string[]; // normalized fmKeys
  templatesConfigured: boolean;
  onboardingCompletedAt: string;
};
```

## How It Works

### Onboarding Completion

1. User completes onboarding (creates workspace, adds FM profiles, configures templates)
2. `POST /api/onboarding/complete` gathers:
   - Spreadsheet ID and Drive folder ID from cookies
   - FM profiles from Sheets (normalized fmKeys)
   - Template configuration status
3. Calls `saveWorkspaceConfig()` to write to Users Sheet ONCE
4. Sets `workspaceReady=true` cookie (and optional cache cookies)

### Workspace Restoration

1. `loadWorkspace()` is called on `/pro` page load
2. **Fast path**: If `workspaceReady=true` cookie exists → return workspace from cookies (no Sheets calls)
3. **Fallback**: If cookie missing → load from Users Sheet, return workspace, cookies are set by bootstrap endpoint
4. **Bootstrap endpoint**: `GET /api/workspace/bootstrap` can be called by client to refresh cookies if needed

### Reset Workspace

1. User clicks "Reset Workspace" in Settings → Danger Zone
2. Types "RESET" to confirm
3. `POST /api/workspace/reset`:
   - Clears workspace fields in Users Sheet (does NOT delete Drive files)
   - Clears workspace cookies
   - Redirects to `/onboarding?reset=true`

## What's Stored Where

### Users Sheet (Source of Truth)
- `spreadsheet_id` - Workspace spreadsheet ID
- `drive_folder_id` - Drive folder ID  
- `fm_profiles_json` - JSON string array of normalized fmKeys
- `templates_configured` - "TRUE" or "FALSE"
- `onboarding_completed_at` - ISO timestamp

### Cookies (Fast Path / Hints)
- `workspaceReady` - "true" if workspace exists
- `workspaceSpreadsheetId` - Optional cache (not source of truth)
- `workspaceDriveFolderId` - Optional cache (not source of truth)
- `onboardingCompletedAt` - Timestamp

**Important**: Cookies are hints, not truth. FM profiles and templatesConfigured are NOT stored in cookies (they're loaded separately when needed).

## Guardrails

The system includes console warnings for:

1. **workspaceReady=true but Users sheet missing workspace data**
   - Detected in `loadWorkspace()` when cookie says ready but sheet data is missing

2. **Template exists but page dimensions mismatch**
   - Detected in `templateConfig.ts` when template has dimensions but using pct fallback
   - Logged for visibility (no auto-correction)

3. **fmKey normalized mismatch**
   - Detected in `templatesSheets.ts` and `signedProcessor.ts`
   - Warns when requested fmKey normalizes differently than stored template fmKey

## API Endpoints

### `GET /api/workspace/bootstrap`
- Returns workspace config and sets cookies if needed
- Client can call this once on app load if `workspaceReady` cookie is missing

### `POST /api/workspace/reset`
- Clears workspace configuration
- Requires authentication
- Does NOT delete Drive files or spreadsheet data
- Archives templates (sets `archived=true`, doesn't hard delete)

## Migration Notes

- Existing users with workspace data will automatically restore on next login
- Cookies expire after 30 days, but JWT token persists spreadsheet ID for restoration
- If both cookies and JWT token are missing, user will need to complete onboarding again

