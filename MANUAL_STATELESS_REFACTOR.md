# Manual Upload Flow - Stateless Refactor

## Overview

The Manual upload flow has been refactored to be **completely stateless**. Work orders are no longer saved to the database. Instead, the flow is:

**PDF(s) → AI Parse → In-Memory WorkOrders[] → Preview Table + CSV Download**

## Changes Made

### 1. New Types (`lib/workOrders/parsedTypes.ts`)

Created new types for stateless work orders:

- `ParsedWorkOrder` - Simplified work order without DB fields (no id, userId, createdAt)
- `ManualProcessResponse` - Response format with workOrders, csv, and meta

### 2. Refactored API Route (`app/api/process-pdf/route.ts`)

**Removed:**
- ❌ All database writes (`workOrderRepo.saveMany()`)
- ❌ Duplicate checking (`workOrderRepo.findByWorkOrderNumbers()`)
- ❌ User ID attachment (not needed for stateless flow)
- ❌ All imports related to work order repository

**Added:**
- ✅ CSV generation function (`generateCsv()`)
- ✅ Returns `ParsedWorkOrder[]` instead of saved `WorkOrder[]`
- ✅ Returns CSV string in response
- ✅ Returns metadata (fileCount, processedAt, aiModel)

**Response Format:**
```json
{
  "workOrders": [
    {
      "workOrderNumber": "123456",
      "scheduledDate": "2025-01-15",
      "customerName": "...",
      "serviceAddress": "...",
      "jobType": "...",
      "amount": "125.00",
      "currency": "USD",
      "notes": "...",
      "priority": "...",
      "vendorName": "...",
      "jobDescription": "...",
      "timestampExtracted": "2025-01-15T10:00:00Z"
    }
  ],
  "csv": "Work Order Number,Scheduled Date,...\n123456,2025-01-15,...",
  "meta": {
    "fileCount": 1,
    "processedAt": "2025-01-15T10:00:00Z",
    "aiModel": "gpt-4o-mini"
  }
}
```

### 3. New Preview Component (`components/manual/ParsedWorkOrdersPreview.tsx`)

Created a new component that:
- Displays parsed work orders in a table
- Shows key fields: Work Order #, Date, Customer, Address, Job Type, Amount, Notes
- Provides "Download CSV" button (uses CSV from response)
- Provides "Clear" button to reset the preview

### 4. Updated Manual Page (`app/manual/page.tsx`)

**Changes:**
- Added state to store parsed data (`parsedData`)
- Updated response handling to work with new format
- Removed references to `createdWorkOrders` and `skippedAsDuplicate`
- Added `ParsedWorkOrdersPreview` component to display results
- Preview appears after successful processing

## CSV Export

The CSV is generated server-side and includes:

- Work Order Number
- Scheduled Date
- Customer Name
- Service Address
- Job Type
- Job Description
- Amount
- Currency
- Priority
- Notes
- Vendor Name
- Timestamp Extracted

CSV is properly escaped:
- Fields with quotes, commas, or newlines are wrapped in double quotes
- Internal quotes are escaped (`"` → `""`)
- Empty/null values are represented as empty strings

## Flow Diagram

```
User uploads PDF
    ↓
/api/process-pdf (POST)
    ↓
Extract PDF text
    ↓
AI Parse (or rule-based fallback)
    ↓
Generate ParsedWorkOrder[]
    ↓
Generate CSV string
    ↓
Return { workOrders, csv, meta }
    ↓
Frontend displays preview table
    ↓
User clicks "Download CSV"
    ↓
CSV file downloads (work_orders_<timestamp>.csv)
```

## Database Impact

**No database writes occur** in the Manual upload flow:
- ✅ No `workOrderRepo.saveMany()` calls
- ✅ No `workOrderRepo.findByWorkOrderNumbers()` calls
- ✅ No duplicate checking
- ✅ No user ID required (authentication still required for access)

The database is still used for:
- User authentication (NextAuth sessions)
- Other features (settings, etc.)

## Testing Checklist

- [ ] Sign in with Google
- [ ] Go to Manual tab
- [ ] Upload a PDF
- [ ] Verify preview table appears with parsed work orders
- [ ] Click "Download CSV"
- [ ] Verify CSV file downloads with correct filename
- [ ] Open CSV in Excel/Google Sheets
- [ ] Verify all columns are present and data is correct
- [ ] Verify CSV escaping works (test with quotes, commas in data)
- [ ] Click "Clear" - verify preview disappears
- [ ] Refresh page - verify preview is cleared (stateless)
- [ ] Check database - verify NO new work orders were created

## Files Modified

1. `lib/workOrders/parsedTypes.ts` - **NEW** - Types for stateless work orders
2. `app/api/process-pdf/route.ts` - **MODIFIED** - Removed DB writes, added CSV generation
3. `components/manual/ParsedWorkOrdersPreview.tsx` - **NEW** - Preview table component
4. `app/manual/page.tsx` - **MODIFIED** - Updated to show preview and handle new response

## Notes

- Manual upload is now completely stateless
- Work orders exist only in memory during the parsing session
- CSV is generated server-side for security
- Preview is cleared on page refresh (no persistence)
- Authentication is still required (for access control)
- The database schema and repository remain intact for future use (e.g., persistent job board feature)

