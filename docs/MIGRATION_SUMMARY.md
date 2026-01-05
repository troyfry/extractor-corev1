# Workspace Migration Summary

## ✅ Step 1: Created `lib/workspace/workspaceRequired.ts`
- Helper that calls `getWorkspace()` and returns a 401/400 JSON error if workspace is not configured
- Returns `WorkspaceResult` (never null) when workspace is found
- **Side-effect free**: Does NOT set cookies itself, only returns workspace

## ✅ Step 2: Cookie Rehydration Centralization
- **All routes use single helper**: `rehydrateWorkspaceCookies(response, workspace)` from `lib/workspace/workspaceCookies.ts`
- No ad-hoc cookie sets in routes - all rehydration goes through the centralized helper
- Helper is called conditionally: only when `workspaceResult.source === "users_sheet"`

## ✅ Step 3: Template Save Routes and PDF Points Validation

### Templates Used for Signed OCR
- **Only "Templates" sheet is used for signed OCR** (via `getTemplateByFmKey()` → `listTemplatesForUser()`)
- Templates in "Templates" sheet **MUST have PDF points** (`xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt`)
- `getTemplateConfigForFmKey()` enforces: if `coordSystem === "PDF_POINTS_TOP_LEFT"`, all PDF point fields must exist and be valid
- If PDF points are missing, template is treated as "TEMPLATE_NOT_CONFIGURED" (throws error)

### Template Save Routes
1. **`app/api/onboarding/templates/save/route.ts`**:
   - Saves to **"Templates" sheet** (used by signed OCR)
   - Stores **PDF points** (`xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt`)
   - **Server-side validation**: Uses `validatePdfPoints()` before persisting
   - ✅ **Safe for signed OCR**

2. **`app/api/templates/save/route.ts`** (Pro templates):
   - Saves to **"Settings" sheet** (NOT used by signed OCR)
   - Stores **percentages only** (`xPct, yPct, wPct, hPct`)
   - These templates are **UI-only** and never drive signed OCR processing
   - ✅ **Safe** - separate sheet, not used for signed OCR

### Conclusion
**Templates used for signed OCR store PDF points and are validated server-side; percentage-based templates in "Settings" sheet are UI-only and never drive signed OCR.**

## ⚠️ Known Gaps / Follow-ups

### Gap 1: `loadWorkspace()` vs `getWorkspace()` Split-Brain
**Status**: ⚠️ **VERIFIED SPLIT-BRAIN** - Both functions duplicate logic but don't call each other

**Verification Results**:
- ✅ Both use `readWorkspaceCookies()` and `validateWorkspaceVersion()` (same cookie reading)
- ✅ Both load from Users Sheet using `getUserRowById()` (same source of truth)
- ✅ Both follow same priority: cookies → Users Sheet
- ⚠️ **DIFFERENCE**: They check different cookie flags:
  - `getWorkspace()` checks `wsCookies.onboardingCompleted === "true"`
  - `loadWorkspace()` checks `wsCookies.workspaceReady === "true"`
- ⚠️ **DIFFERENCE**: They return different types:
  - `getWorkspace()` returns `UserWorkspace` (simpler, focused on core workspace)
  - `loadWorkspace()` returns `WorkspaceConfig` (includes Gmail labels, FM profiles)

**Impact**: 
- Routes using `loadWorkspace()` (bootstrap, update, gmail routes) may resolve workspace differently than routes using `getWorkspace()` if cookie flags differ
- This is a **regression risk** if cookie flags get out of sync

**Follow-up Required**:
- **Option A (Recommended)**: Make `loadWorkspace()` call `getWorkspace()` and convert `UserWorkspace` → `WorkspaceConfig`
- **Option B**: Consolidate into a single function with type conversion
- **Option C**: Document that they serve different purposes and add a test to ensure they stay in sync

**Current Status**: Routes using `loadWorkspace()` are marked as "already compliant" but they may resolve workspace differently if cookie flags differ. This needs to be addressed to prevent regression.

## Migrated Routes

### Tier 0 (Signed) - All migrated:
1. ✅ `app/api/signed/process/route.ts`
2. ✅ `app/api/signed/resolve/route.ts`
3. ✅ `app/api/signed/override/route.ts`
4. ✅ `app/api/signed/needs-review/route.ts`
5. ✅ `app/api/signed/gmail/process/route.ts`

### Tier 1 (Workspace):
- `app/api/workspace/bootstrap/route.ts` - Uses `loadWorkspace()` (needs verification)
- `app/api/workspace/update/route.ts` - Uses `loadWorkspace()` (needs verification)
- `app/api/workspace/reset/route.ts` - Uses `getUserSpreadsheetId()` (appropriate for reset)
- `app/api/user-settings/spreadsheet-id/route.ts` - Intentionally reads cookies (manages spreadsheet ID settings)

### Tier 2 (Gmail):
- `app/api/gmail/process/route.ts` - Uses `loadWorkspace()` (needs verification)
- `app/api/gmail/list/route.ts` - Uses `loadWorkspace()` (needs verification)

### Tier 3 (Templates) - All migrated:
- ✅ `app/api/templates/save/route.ts` - Migrated to `workspaceRequired()`, saves to "Settings" sheet (UI-only)
- ✅ `app/api/templates/get/route.ts` - Migrated to `workspaceRequired()`
- ✅ `app/api/onboarding/templates/save/route.ts` - Added server-side `validatePdfPoints()` validation

### Tier 4 (Extraction) - Migrated:
- ✅ `app/api/extract-pro/route.ts` - Migrated to `workspaceRequired()`
- `app/api/process-pdf/route.ts` - No cookie reads found (already compliant)

## Changes Made
- All migrated routes now use `workspaceRequired()` for centralized workspace resolution
- Cookie rehydration added to all migrated routes when workspace is loaded from Users Sheet
- Server-side PDF point validation added to onboarding templates save route
- Build passes with no TypeScript errors

