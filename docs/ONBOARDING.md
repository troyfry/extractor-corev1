# Onboarding Flow Documentation

## Overview

The onboarding system guides new users through setting up their workspace, connecting Google services, and configuring Gmail labels. It uses a cookie-based state management system to track progress and prevent redirect loops.

## Architecture

### Key Components

1. **Layout Guard** (`app/onboarding/layout.tsx`): Server-side route protection and resume logic
2. **Onboarding Pages**: Client-side UI for each step
3. **API Routes**: Server-side handlers for each onboarding action
4. **Status Management** (`lib/onboarding/status.ts`): Cookie-first status checking
5. **Workspace Cookies** (`lib/workspace/workspaceCookies.ts`): Cookie management utilities

### State Management

The system uses **cookies as the primary state mechanism** to avoid Google Sheets API quota issues:

- `onboardingCompleted`: Set to `"true"` when onboarding is complete
- `workspaceReady`: Set to `"true"` when Google Sheets/Drive setup is complete
- `googleSheetsSpreadsheetId`: The user's spreadsheet ID
- `googleDriveFolderId`: The user's Drive folder ID
- Gmail label cookies: Label names and IDs for queue, signed, and processed labels

## Onboarding Flow

### Step 1: Landing Page (`/onboarding`)

**File**: `app/onboarding/page.tsx`

- Welcome page with "Start Setup" button
- Redirects to `/onboarding/google`

### Step 2: Google Workspace Setup (`/onboarding/google`)

**File**: `app/onboarding/google/page.tsx`  
**API**: `POST /api/onboarding/google`

**User Actions**:
- Enter Drive folder name (default: "Work Orders")
- Enter Spreadsheet name (required, default: "Work Order Workspace")

**Backend Process** (`app/api/onboarding/google/route.ts`):
1. **Idempotency Check**: If `workspaceReady` cookie exists, return existing workspace (prevents duplicate creation)
2. **Create/Find Drive Folder**: Uses `getOrCreateFolder()` to find or create folder
3. **Create/Find Spreadsheet**: 
   - Searches for existing spreadsheet by name
   - Creates new spreadsheet if not found
   - Ensures required tabs exist: `Work_Orders`, `Verification`, `Signatures`, `Config`
4. **Write Headers**: Writes column headers to `Work_Orders` sheet (idempotent)
5. **Set Cookies**: Sets `workspaceReady`, `googleSheetsSpreadsheetId`, `googleDriveFolderId`
6. **DB Integration**: Creates workspace in database via `getOrCreateWorkspace()`

**Response**: Returns folder ID, spreadsheet ID, and URLs

**Next Step**: Auto-redirects to `/onboarding/gmail` after 2 seconds

### Step 3: Gmail Label Configuration (`/onboarding/gmail`)

**File**: `app/onboarding/gmail/page.tsx`

**User Actions**:
- Configure Work Orders label name (default: "Work Orders")
- Configure Signed Work Orders label name (default: "Signed Work Orders")
- Configure Processed label name (optional, default: "Processed Work Orders")
- Can skip to use defaults

**Validation**:
- Labels cannot be system labels (e.g., "INBOX")
- Uses `validateLabelName()` helper

**State Storage**:
- Stores label names in `sessionStorage` (temporary, client-side only)
- Passed to completion step via request body

**Next Step**: Redirects to `/onboarding/done`

### Step 4: Completion (`/onboarding/done`)

**File**: `app/onboarding/done/page.tsx`  
**API**: `POST /api/onboarding/complete`

**Backend Process** (`app/api/onboarding/complete/route.ts`):
1. **Validate Prerequisites**: Checks for spreadsheet ID and folder ID in cookies
2. **Complete Onboarding**: Calls `completeOnboarding()` which:
   - Ensures Users sheet exists
   - Sets `onboardingCompleted` to `TRUE` in Users sheet
   - Sets `onboardingCompleted` cookie
3. **Gather FM Profiles**: Fetches all FM profiles and normalizes keys
4. **Check Templates**: Verifies if templates are configured
5. **Create Gmail Labels**: 
   - Creates label hierarchy via `createLabelHierarchy()`
   - Validates label names (rejects system labels)
   - Creates base label + children (queue, signed, processed)
6. **Save Workspace Config**: Saves to Users sheet via `saveWorkspaceConfig()`:
   - Spreadsheet ID
   - Drive folder ID
   - FM profile keys (normalized)
   - Templates configured flag
   - Gmail label names and IDs
   - Onboarding completion timestamp
7. **Set Cookies**: Sets all workspace cookies for fast access

**Error Handling**:
- If templates are missing crop zones, returns 400 with `redirectTo: /onboarding/templates`
- User is redirected to templates page to configure

**Next Step**: Redirects to `/pro` (which redirects to `/work-orders`)

## Resume Logic

### Layout Guard (`app/onboarding/layout.tsx`)

The layout implements smart resume logic to prevent redirect loops:

**Rule 1**: If `onboardingCompleted === "true"` → Redirect to `/pro`
- **Exception**: Allow access to settings pages (`/onboarding/fm-profiles`, `/onboarding/templates`)

**Rule 2**: If no `workspaceReady` → Allow `/onboarding/google` (correct step)

**Rule 3**: If workspace ready but onboarding not complete → Allow onboarding pages to render
- Prevents redirect loops when workspace cookie exists but `loadWorkspace()` fails

### Middleware Protection (`middleware.ts`)

- Onboarding routes require authentication
- If not authenticated, redirects to sign-in with callback URL
- Sets `x-pathname` header for layout to check current page

## Status Checking

### Cookie-First Strategy

The system prioritizes cookies to avoid Google Sheets API quota issues:

1. **Check `onboardingCompleted` cookie FIRST** → Return immediately if `true` (no API calls)
2. **Check quota cooldown cookie** → If active, return cached "not completed" state
3. **If cookie missing**, attempt ONE Sheets read (no `ensureUsersSheet`)
4. **Handle quota errors gracefully** → Set cooldown cookie and return cached state

### API Endpoint

**GET `/api/onboarding/status`**

Returns:
```json
{
  "onboardingCompleted": boolean,
  "isAuthenticated": boolean,
  "degraded": boolean  // If quota cooldown is active
}
```

## Optional Steps

### OpenAI Setup (`/onboarding/openai`)

**Status**: Optional, skipped in main flow

- Users can configure OpenAI API key for AI-powered extraction
- Not required for basic functionality

### FM Profiles (`/onboarding/fm-profiles`)

**Status**: Settings page, not onboarding step

- Can be accessed after onboarding
- Used to configure Facility Management profiles

### Templates (`/onboarding/templates`)

**Status**: Settings page, but required for automation

- Must have at least one template with Work Order Number crop zone configured
- If missing during completion, user is redirected here

## Reset Onboarding

**API**: `POST /api/onboarding/reset`

Clears all onboarding-related cookies:
- `onboardingCompleted`
- `workspaceReady`
- `openaiReady`
- `fmProfilesReady`
- `googleSheetsSpreadsheetId`
- `googleDriveFolderId`
- `onboardingStatusDegraded`

**Use Case**: Allows users to restart onboarding if they encounter issues

## Database Integration

### Workspace Creation

During Google setup (`/api/onboarding/google`), the system:
1. Creates workspace in database via `getOrCreateWorkspace()`
2. Links workspace to spreadsheet ID
3. Creates workspace member record for the user

**DB Schema**:
- `workspaces`: Stores spreadsheet ID, drive folder ID, name
- `workspace_members`: Links users to workspaces with roles

### Primary Read Source

Workspaces can be configured with `primary_read_source`:
- `LEGACY`: Uses Google Sheets as primary data source
- `DB`: Uses database as primary data source (DB Native Mode)

## Cookie Management

### Workspace Cookies (`lib/workspace/workspaceCookies.ts`)

**Single Source of Truth**: All cookie operations go through utility functions:

- `readWorkspaceCookies()`: Read all workspace cookies
- `rehydrateWorkspaceCookies()`: Set cookies from workspace data
- `clearWorkspaceCookies()`: Clear all workspace cookies
- `validateWorkspaceVersion()`: Check cookie version compatibility

**Cookie Versioning**: `WORKSPACE_VERSION = "2.0"`
- Incremented when workspace structure changes
- Mismatched versions trigger reload from Users Sheet

### Cookie Options

All workspace cookies use:
- `httpOnly: true` (security)
- `secure: true` (production only)
- `sameSite: "lax"`
- `maxAge: 30 days`

## Error Handling

### Quota Protection

The system implements multiple layers of quota protection:

1. **Cookie-First Checks**: Avoid Sheets API calls when possible
2. **Quota Cooldown**: Sets `sheetsQuotaCooldownUntil` cookie on quota errors
3. **Degraded Mode**: Returns cached state when quota is exhausted
4. **Rate Limiting**: Prevents spam calls to Google setup endpoint

### Graceful Degradation

- If Sheets API fails, system falls back to cookie-based state
- Users can still access onboarding pages
- Status endpoint returns `degraded: true` when in fallback mode

## Routes Reference

| Route | Purpose | Auth Required |
|-------|---------|---------------|
| `/onboarding` | Landing page | Yes |
| `/onboarding/google` | Google Sheets/Drive setup | Yes |
| `/onboarding/gmail` | Gmail label configuration | Yes |
| `/onboarding/done` | Completion handler | Yes |
| `/onboarding/openai` | OpenAI API key setup (optional) | Yes |
| `/onboarding/fm-profiles` | FM profile management (settings) | Yes |
| `/onboarding/templates` | Template management (settings) | Yes |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/onboarding/google` | POST | Create/find workspace |
| `/api/onboarding/complete` | POST | Complete onboarding |
| `/api/onboarding/status` | GET | Check onboarding status |
| `/api/onboarding/reset` | POST | Reset onboarding progress |
| `/api/onboarding/openai` | POST | Save OpenAI API key |
| `/api/onboarding/fm-profiles` | GET/POST | Manage FM profiles |
| `/api/onboarding/templates/*` | GET/POST | Manage templates |

## Key Files

### Pages
- `app/onboarding/page.tsx` - Landing page
- `app/onboarding/google/page.tsx` - Google setup
- `app/onboarding/gmail/page.tsx` - Gmail labels
- `app/onboarding/done/page.tsx` - Completion
- `app/onboarding/layout.tsx` - Layout guard

### API Routes
- `app/api/onboarding/google/route.ts` - Workspace creation
- `app/api/onboarding/complete/route.ts` - Completion handler
- `app/api/onboarding/status/route.ts` - Status check
- `app/api/onboarding/reset/route.ts` - Reset handler

### Utilities
- `lib/onboarding/status.ts` - Status checking logic
- `lib/workspace/workspaceCookies.ts` - Cookie management
- `lib/workspace/saveWorkspace.ts` - Workspace persistence

## Best Practices

1. **Always check cookies first** before making Sheets API calls
2. **Use idempotent operations** to prevent duplicate resources
3. **Handle quota errors gracefully** with cooldown mechanisms
4. **Set cookies immediately** after successful operations
5. **Validate prerequisites** before completing onboarding
6. **Use workspace utilities** for all cookie operations (never direct access)

## Future Improvements

- [ ] Add progress indicator showing current step
- [ ] Add ability to skip optional steps
- [ ] Add validation for spreadsheet permissions
- [ ] Add workspace migration support
- [ ] Add onboarding analytics
