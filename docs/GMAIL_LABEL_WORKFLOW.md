# Gmail Label Workflow for Work Order Emails

This document explains how work order emails move through Gmail labels/tags in the system.

## Overview

The system uses Gmail labels to organize and track work order emails through different stages of processing. Labels act as a queue system, allowing the application to identify which emails need processing and track their status.

## Label Types

The system uses three types of Gmail labels:

### 1. **Work Orders Label** (Source Queue)
- **Default Name**: `Work Orders/To Process`
- **Purpose**: Identifies emails that contain work orders waiting to be processed
- **Configuration**: Set during onboarding or in settings
- **Environment Variable**: `GMAIL_WORK_ORDERS_LABEL_NAME`

### 2. **Signed Work Orders Label** (Archive/Reference)
- **Default Name**: `Work Orders/Signed To Match`
- **Purpose**: Used to identify signed work orders for template matching
- **Configuration**: Set during onboarding or in settings
- **Environment Variable**: `GMAIL_SIGNED_WORK_ORDERS_LABEL_NAME`

### 3. **Processed Label** (Optional - Completion Tracking)
- **Default Name**: `Work Orders/Processed`
- **Purpose**: Marks emails that have been successfully processed
- **Configuration**: Optional, can be set in settings or left empty
- **Environment Variable**: `GMAIL_PROCESSED_LABEL_NAME`

## Email Processing Flow

### Step 1: Email Discovery

The system searches for emails with:
- **Required**: The "Work Orders" label (or configured label name)
- **Required**: PDF attachments
- **Not Filtered By**: Subject line, sender, or recipient

**Code Location**: `lib/google/gmail.ts` - `listWorkOrderEmails()`

```typescript
// Query: label:"Work Orders/To Process" has:attachment filename:pdf
```

### Step 2: Email Processing

When an email is processed via `/api/gmail/process`:

1. **Extract PDF attachments** from the email
2. **Parse work order data** from PDFs (OCR, template matching)
3. **Save work orders** to Google Sheets
4. **Handle labels** (only if processing succeeds)

**Code Location**: `app/api/gmail/process/route.ts`

### Step 3: Label Movement (After Successful Processing)

If `autoRemoveLabel` is enabled and processing succeeds:

1. **Remove** the source "Work Orders" label from the email
2. **Apply** the "Processed" label (if configured)

**Important**: Labels are only moved **after** successful processing. If processing fails, the email keeps its original label so it can be retried.

**Code Location**: `app/api/gmail/process/route.ts` (lines 789-815)

```typescript
// Only executed if ALL processing steps succeeded
if (autoRemoveLabel) {
  // Remove source label
  await removeLabelById(accessToken, messageId, workspace.gmailWorkOrdersLabelId);
  
  // Apply processed label (if configured)
  if (workspace.gmailProcessedLabelId) {
    await applyLabelById(accessToken, messageId, workspace.gmailProcessedLabelId);
  }
}
```

## Label Configuration

### During Onboarding

Labels are configured in the Gmail setup step:
- User selects or creates labels for work orders
- System validates that labels are not system labels (e.g., INBOX)
- Labels are created in Gmail if they don't exist
- Label IDs are stored in workspace configuration

**Code Location**: `app/onboarding/gmail/page.tsx`

### In Settings

Labels can be updated in the Pro Settings page:
- Change label names
- Enable/disable processed label
- System automatically creates labels if missing

**Code Location**: `app/pro/settings/page.tsx`

**API Endpoint**: `POST /api/workspace/update`

## Label Validation

The system prevents using Gmail system labels as custom labels:

**Forbidden Labels**:
- `INBOX`
- Other Gmail system labels

**Code Location**: `lib/google/gmailValidation.ts`

```typescript
const FORBIDDEN_LABELS = ["INBOX", ...];
```

## Label Storage

Label information is stored in the workspace configuration:

```typescript
{
  gmailWorkOrdersLabelName: "Work Orders/To Process",
  gmailWorkOrdersLabelId: "Label_123456789",
  gmailSignedLabelName: "Work Orders/Signed To Match",
  gmailSignedLabelId: "Label_987654321",
  gmailProcessedLabelName: "Work Orders/Processed", // or null
  gmailProcessedLabelId: "Label_456789012" // or null
}
```

**Storage Location**: Google Sheets (Workspace configuration sheet)

## Workflow Diagram

```
┌─────────────────────────────────────┐
│  Email arrives in Gmail             │
│  User applies "Work Orders" label   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  System discovers email             │
│  (has label + PDF attachment)       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  User clicks "Process" or            │
│  Batch process is triggered         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Extract PDFs                        │
│  Parse work order data               │
│  Save to Google Sheets               │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │             │
    Success?      Failure?
        │             │
        ▼             ▼
┌──────────────┐ ┌──────────────┐
│ Remove       │ │ Keep label   │
│ "Work Orders"│ │ (retry later)│
│ label        │ └──────────────┘
│              │
│ Apply        │
│ "Processed"  │
│ label (if    │
│ configured)  │
└──────────────┘
```

## Error Handling

### Processing Failure
- **Label Behavior**: Email **keeps** the "Work Orders" label
- **Reason**: Allows retry of failed processing
- **User Action**: Can manually retry processing

### Label Operation Failure
- **Label Behavior**: Processing succeeds, but label operations may fail
- **Reason**: Label operations are non-critical (processing already completed)
- **Logging**: Errors are logged but don't fail the request

## Best Practices

1. **Use Descriptive Label Names**: Use clear, hierarchical names like `Work Orders/To Process`
2. **Enable Processed Label**: Helps track which emails have been processed
3. **Monitor Label Operations**: Check logs if labels aren't moving as expected
4. **Avoid System Labels**: Never use INBOX or other system labels
5. **Consistent Naming**: Use the same label structure across your organization

## Troubleshooting

### Emails Not Being Discovered
- **Check**: Label name matches workspace configuration
- **Check**: Emails have PDF attachments
- **Check**: Label exists in Gmail (case-insensitive match)

### Labels Not Moving After Processing
- **Check**: `autoRemoveLabel` parameter is enabled
- **Check**: Workspace has label IDs stored
- **Check**: Gmail API permissions are correct
- **Check**: Server logs for label operation errors

### Label Creation Fails
- **Check**: Label name is not a system label (INBOX, etc.)
- **Check**: Gmail API has label creation permissions
- **Check**: Label name doesn't already exist

## Code References

- **Label Configuration**: `lib/google/gmailConfig.ts`
- **Label Validation**: `lib/google/gmailValidation.ts`
- **Label Operations**: `lib/google/gmail.ts`
- **Processing Logic**: `app/api/gmail/process/route.ts`
- **Workspace Update**: `app/api/workspace/update/route.ts`

## Environment Variables

```bash
# Optional: Override default label names
GMAIL_WORK_ORDERS_LABEL_NAME="Work Orders/To Process"
GMAIL_SIGNED_WORK_ORDERS_LABEL_NAME="Work Orders/Signed To Match"
GMAIL_PROCESSED_LABEL_NAME="Work Orders/Processed"
```

## Notes

- Labels are case-insensitive when searching
- Label IDs are cached to reduce API calls
- Labels are automatically created if they don't exist
- The system never modifies emails, only their labels
- Multiple labels can exist on an email simultaneously

