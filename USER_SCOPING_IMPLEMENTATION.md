# User-Scoped Work Orders Implementation Summary

## Overview

All work orders are now scoped to individual users. Each authenticated user can only see and manipulate their own work orders. This ensures data isolation and security.

## Changes Made

### 1. Authentication & Session Updates

**Files Modified:**
- `auth.ts` - Updated JWT and session callbacks to store `userId` from Google's `sub` claim
- `types/next-auth.d.ts` - Extended types to include `userId` in session and JWT

**Key Changes:**
- `userId` is now stored in the JWT token and session
- Uses Google OAuth's `sub` (subject) claim as the stable user identifier
- `session.userId` is available server-side via `auth()` helper

### 2. Database Schema Updates

**Files Modified:**
- `db/schema.ts` - Added `userId` column to `work_orders` table

**Key Changes:**
- Added `userId: varchar("user_id", { length: 255 }).notNull()` to work_orders table
- All work orders must have a userId (non-nullable)

**Migration Required:**
You'll need to run a database migration to add the `userId` column. Existing work orders will need to be handled (either deleted or assigned to a default user).

### 3. Type System Updates

**Files Modified:**
- `lib/workOrders/types.ts` - Added `userId` to `WorkOrder` and `WorkOrderInput` types
- `lib/workOrders/mappers.ts` - Updated mappers to handle `userId` field

**Key Changes:**
- `WorkOrder` type now includes `userId: string`
- `WorkOrderInput` type now requires `userId: string` (not optional)

### 4. Repository Updates

**Files Modified:**
- `lib/workOrders/repository.ts` - Completely refactored to be user-scoped

**Key Changes:**
- Removed `getAll()` method (replaced with `listForUser()`)
- Added `listForUser(userId: string, options?)` - returns work orders for a specific user
- Added `getByIdForUser(userId: string, id: string)` - gets work order only if it belongs to user
- Updated `findByWorkOrderNumbers(userId: string, numbers: string[])` - now scoped to user
- Added `clearForUser(userId: string)` - clears work orders for a specific user
- All queries now filter by `userId` at the database level

### 5. Processing Logic Updates

**Files Modified:**
- `lib/workOrders/processing.ts` - Updated to require and use `userId`

**Key Changes:**
- `processSingleEmailMessage()` now requires `userId` parameter
- `buildWorkOrderInputsFromEmail()` returns work orders without `userId` (must be attached separately)
- All work orders are automatically attached with the current user's `userId`
- Duplicate detection is now scoped to the user (same work order number can exist for different users)

### 6. API Route Updates

**Files Modified:**
- `app/api/process-pdf/route.ts` - Added authentication check and userId attachment
- `app/api/work-orders/route.ts` - All endpoints now user-scoped
- `app/api/email-messages/[id]/process/route.ts` - Added userId parameter

**Key Changes:**
- All routes check authentication using `auth()` helper
- Returns 401 Unauthorized if no session or userId
- `POST /api/process-pdf` - Attaches userId to all created work orders
- `GET /api/work-orders` - Returns only work orders for the authenticated user
- `POST /api/work-orders` - Automatically attaches userId from session
- `DELETE /api/work-orders` - Deletes only work orders for the authenticated user

### 7. CSV Export Endpoint

**Files Created:**
- `app/api/work-orders/export/route.ts` - Server-side CSV export

**Key Features:**
- Requires authentication
- Exports only work orders for the authenticated user
- CSV is built server-side (secure, no client-side data exposure)
- Proper CSV escaping for quotes, commas, and newlines
- Returns CSV file with appropriate headers

### 8. UI Updates

**Files Modified:**
- `app/work-orders/page.tsx` - Converted to server component with auth check
- `components/work-orders/ResultsTable.tsx` - Updated CSV download to use server endpoint
- `components/work-orders/WorkOrdersList.tsx` - New component to fetch and display user's work orders

**Key Changes:**
- Work orders page now redirects to sign-in if not authenticated
- Work orders list fetches from `/api/work-orders` (automatically user-scoped)
- CSV download button now uses `/api/work-orders/export` endpoint
- Removed client-side CSV generation (more secure)

## Security Features

1. **Database-Level Filtering**: All queries filter by `userId` at the database level
2. **Authentication Required**: All work order endpoints require authentication
3. **Server-Side Validation**: userId is always set server-side from session, never from client
4. **No Data Leakage**: Users can never see or access other users' work orders
5. **Secure CSV Export**: CSV is generated server-side with only the user's data

## Testing Checklist

- [ ] Sign in with Google account A
- [ ] Upload a PDF in Manual tab
- [ ] Verify work order is created with userId from account A
- [ ] View Work Orders tab - should see only account A's work orders
- [ ] Download CSV - should contain only account A's work orders
- [ ] Sign out and sign in with Google account B
- [ ] View Work Orders tab - should see empty list (or account B's work orders)
- [ ] Upload a PDF - should create work order with account B's userId
- [ ] Verify account A's work orders are not visible to account B
- [ ] Verify duplicate work order numbers are allowed for different users

## Database Migration

You'll need to add the `userId` column to your existing `work_orders` table. Here's a sample migration:

```sql
-- Add userId column
ALTER TABLE work_orders ADD COLUMN user_id VARCHAR(255);

-- For existing data, you may want to:
-- 1. Delete all existing work orders (if testing), OR
-- 2. Assign them to a default user (if you have one)

-- Make it NOT NULL after handling existing data
ALTER TABLE work_orders ALTER COLUMN user_id SET NOT NULL;
```

Or use Drizzle migrations:
```bash
pnpm db:generate
pnpm db:migrate
```

## Notes

- The `userId` is derived from Google OAuth's `sub` claim, which is a stable identifier
- Duplicate work order numbers are allowed across different users
- All work order operations are now user-scoped by default
- The CSV export is server-side only for security
- No Gmail or Sheets API integration yet - this phase is auth and user-scoping only

