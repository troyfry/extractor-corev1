# Testing Guide: Gmail Processing Updates

This guide covers how to test the recent changes to `/api/gmail/process`:
1. **No fake UNKNOWN work order numbers** - Missing WO# routes to "Needs Review"
2. **Label not removed if 0 work orders extracted**
3. **Stable issuerKey from email sender domain**

## Prerequisites

1. **Local Development Setup**
   ```bash
   npm run dev
   ```

2. **Required Environment Variables**
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (for OAuth)
   - `OPENAI_API_KEY` (if AI parsing is enabled)
   - Database connection (PostgreSQL)

3. **Google Account Setup**
   - Authenticated user with Gmail access
   - Google Sheets spreadsheet configured in Settings
   - Test emails in Gmail with PDF attachments

## Test Scenarios

### 1. Test: Missing Work Order Number → Routes to "Needs Review"

**Goal**: Verify that work orders without WO# go to "Needs Review" sheet, not main sheet.

**Steps**:
1. Find or create a Gmail email with a PDF that has **no work order number** in:
   - Email subject
   - PDF filename
   - PDF content (if AI parsing fails)
2. Apply your Gmail label to the email
3. Process the email via UI or API
4. Check Google Sheets:
   - ✅ Should appear in **"Needs Review"** sheet/tab
   - ✅ `wo_number` column should be empty or "MISSING"
   - ✅ `jobId` should start with `needs_review:`
   - ❌ Should NOT appear in main "Sheet1"

**API Test**:
```bash
curl -X POST http://localhost:3000/api/gmail/process \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "messageId": "your-gmail-message-id",
    "autoRemoveLabel": false
  }'
```

**Expected Logs**:
```
[Gmail Process] Could not extract work order number from email subject ("...") or PDF filename ("..."). Will route to "Needs Review" sheet.
[Gmail Process] Extracted issuerKey from sender: sender@example.com -> example.com
[Sheets Ingestion] Wrote work order to Needs Review: needs_review:...
```

---

### 2. Test: Zero Work Orders Extracted → Label NOT Removed

**Goal**: Verify that if no work orders are extracted, the Gmail label remains intact.

**Steps**:
1. Find or create a Gmail email with a PDF that **cannot be parsed** (e.g., image-only PDF, corrupted PDF, or empty PDF)
2. Apply your Gmail label to the email
3. Process the email via UI or API
4. Check Gmail:
   - ✅ Label should **still be present** on the email
   - ✅ Email should be processable again (idempotent)
5. Check Google Sheets:
   - ✅ **No new rows** should be created

**API Test**:
```bash
curl -X POST http://localhost:3000/api/gmail/process \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "messageId": "email-with-unparseable-pdf",
    "autoRemoveLabel": true
  }'
```

**Expected Response**:
```json
{
  "error": "No work orders extracted from attachments; leaving label for retry."
}
```

**Expected Logs**:
```
[Gmail Process] Finished processing all PDFs. Total work orders extracted: 0
[Gmail Process] Processing failed for message ...: {
  message: "No work orders extracted from attachments; leaving label for retry.",
  ...
}
```

**Verify Label Status**:
- Check Gmail API or Gmail UI - label should still be on the email

---

### 3. Test: Stable IssuerKey from Email Sender Domain

**Goal**: Verify that `issuerKey` is derived from email sender domain and is stable across re-processes.

**Steps**:
1. Find a Gmail email from `sender@mail.example.com` with a valid PDF
2. Process the email (extract work orders)
3. Check Google Sheets:
   - ✅ `issuer` column should be `example.com` (root domain)
   - ✅ `jobId` should be `example_com:wo_number`
4. Re-process the same email (re-apply label and process again)
5. Check Google Sheets:
   - ✅ Same row should be **updated** (UPSERT), not duplicated
   - ✅ `issuer` should still be `example.com`
   - ✅ `jobId` should be identical

**API Test**:
```bash
# First process
curl -X POST http://localhost:3000/api/gmail/process \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "messageId": "email-from-example-com",
    "autoRemoveLabel": true
  }'

# Re-process (after re-applying label)
curl -X POST http://localhost:3000/api/gmail/process \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{
    "messageId": "email-from-example-com",
    "autoRemoveLabel": true
  }'
```

**Expected Logs**:
```
[Gmail Process] Extracted issuerKey from sender: sender@mail.example.com -> example.com
[Sheets Ingestion] Wrote work order to Sheet1: example_com:wo123
```

**Verify in Sheets**:
- Check that `issuer` column matches the root domain from sender email
- Check that `jobId` format is `normalized_issuer:normalized_wo_number`
- Re-processing should update the same row (check `updated_at` timestamp)

---

### 4. Test: IssuerKey Edge Cases

**Test Different Email Formats**:

| Email From | Expected issuerKey |
|------------|-------------------|
| `sender@example.com` | `example.com` |
| `sender@mail.example.com` | `example.com` |
| `sender@subdomain.mail.example.com` | `example.com` |
| `"Name" <sender@example.com>` | `example.com` |
| `sender@co.uk` | `co.uk` |
| Invalid format | `unknown` |

**Steps**:
1. Create test emails with different sender formats
2. Process each email
3. Verify `issuerKey` in logs and Sheets

**Expected Logs**:
```
[Gmail Process] Extracted issuerKey from sender: sender@mail.example.com -> example.com
```

---

### 5. Test: CSV Export Uses IssuerKey

**Goal**: Verify CSV export uses `issuerKey` (not `vendorName`) for "Issuer" column.

**Steps**:
1. Process a Gmail email with work orders
2. Download CSV from the UI
3. Check CSV:
   - ✅ "Issuer" column should match email sender domain (e.g., `example.com`)
   - ✅ "Job ID" should use `issuerKey` (e.g., `example_com:wo123`)
   - ✅ "Vendor Name" column should still contain original vendor name (if parsed)

**Verify CSV Structure**:
```csv
Job ID,Issuer,Work Order Number,...
example_com:wo123,example.com,wo123,...
```

---

## Manual Testing via UI

### Setup
1. Start dev server: `npm run dev`
2. Navigate to Gmail import page
3. Authenticate with Google (Pro/Premium plan)

### Test Flow
1. **Select an email** with PDF attachment
2. **Apply Gmail label** (e.g., "Work Orders")
3. **Click "Process Selected"** or process individually
4. **Monitor browser console** for logs
5. **Check Google Sheets** for results
6. **Verify Gmail label** status (removed or still present)

---

## Debugging Tips

### Check Logs

**Local Development**:
- Browser console (F12)
- Terminal running `npm run dev`

**Production (Vercel)**:
- Vercel Dashboard → Functions → Logs
- Search for `[Gmail Process]` prefix

### Key Log Messages to Look For

✅ **Success**:
```
[Gmail Process] Extracted issuerKey from sender: ... -> ...
[Gmail Process] Writing work orders to Sheets + Drive: { ... }
[Gmail Process] Successfully wrote work orders to Sheets + Drive
[Gmail Process] Label removed successfully for message ...
```

⚠️ **Warning (Expected)**:
```
[Gmail Process] Could not extract work order number ... Will route to "Needs Review" sheet.
```

❌ **Error (Expected for 0 work orders)**:
```
[Gmail Process] Processing failed for message ...: {
  message: "No work orders extracted from attachments; leaving label for retry."
}
```

### Verify Google Sheets

**Check Required Columns**:
- `jobId` - Should be deterministic (e.g., `example_com:wo123`)
- `issuer` - Should be root domain from email sender
- `wo_number` - Should be extracted WO# or empty/MISSING
- `status` - Should be present
- `original_pdf_url` - Should link to Drive file
- `created_at` - Timestamp
- `signed_at` - Null initially

**Check Sheet Routing**:
- Main sheet ("Sheet1") - Work orders with valid WO#
- "Needs Review" sheet - Work orders without WO#

---

## Quick Test Checklist

- [ ] Missing WO# → Routes to "Needs Review" sheet
- [ ] Zero work orders → Label NOT removed
- [ ] IssuerKey extracted from email sender domain
- [ ] Re-processing same email → UPSERT (no duplicates)
- [ ] CSV export uses issuerKey for "Issuer" column
- [ ] Different email formats → Correct issuerKey extraction
- [ ] Error handling → Clear error messages, label preserved

---

## Troubleshooting

### Issue: Label is removed even when 0 work orders extracted

**Check**:
- Verify guard is working: `if (allParsedWorkOrders.length === 0) throw ...`
- Check logs for error before label removal
- Verify `autoRemoveLabel` is `true` in request

### Issue: Work orders going to wrong sheet

**Check**:
- Verify `workOrderNumber` is `null` (not empty string `""`)
- Check `generateJobId()` logic in `lib/workOrders/sheetsIngestion.ts`
- Verify sheet name logic: `woNumber && woNumber.trim() !== ""`

### Issue: Duplicate rows on re-processing

**Check**:
- Verify `issuerKey` is stable (same for same sender)
- Check `jobId` format matches: `normalized_issuer:normalized_wo_number`
- Verify `writeJobRecord()` uses UPSERT (not append)

---

## Next Steps

After testing, verify:
1. ✅ All test scenarios pass
2. ✅ Google Sheets structure is correct
3. ✅ No duplicate rows on re-processing
4. ✅ Error messages are clear
5. ✅ Labels behave correctly (removed only on success)

