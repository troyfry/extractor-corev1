# PDF Processing Decision Flow

This document explains the decision logic for processing PDFs from Gmail, including when the Python OCR tool is used and how "pass agreement" is determined.

## Overview

The system processes signed work order PDFs through a multi-stage pipeline:
1. **Gmail PDF Discovery & Extraction** - Finding and downloading PDFs from Gmail
2. **Digital Text Extraction** - Attempting to extract text directly from PDF
3. **Python OCR Service** - Using OCR when digital extraction fails
4. **Pass Agreement** - Validating consistency across multiple OCR attempts
5. **Decision Engine** - Determining trust level and automation status

---

## 1. Gmail Initial PDF Read/Scan

### Discovery Process

The system searches Gmail for emails that meet specific criteria:

**Search Criteria:**
- **Required**: Email has the configured "Work Orders" label (e.g., "Work Orders/To Process")
- **Required**: Email has PDF attachments
- **Not Filtered By**: Subject line, sender, or recipient

**Code Location**: `lib/google/gmail.ts` - `listWorkOrderEmails()`

```typescript
// Query: label:"Work Orders/To Process" has:attachment filename:pdf
const baseQ = "has:attachment filename:pdf";
const q = labelId
  ? baseQ
  : labelName
    ? `label:"${labelName}" ${baseQ}`
    : baseQ;
```

### PDF Extraction

Once an email is identified, PDFs are extracted from the message:

**Process:**
1. Fetch full Gmail message via Gmail API
2. Recursively traverse message parts (handles nested multipart structures)
3. Identify PDF attachments by MIME type (`application/pdf`) or filename (`.pdf`)
4. Download each PDF attachment as a Buffer
5. Return email metadata with PDF attachments

**Code Location**: `lib/google/gmail.ts` - `getEmailWithPdfAttachments()`

**Key Functions:**
- `collectParts()` - Recursively searches message parts for PDFs
- `gmail.users.messages.attachments.get()` - Downloads attachment data
- Converts Gmail's URL-safe base64 to standard base64

**Result:**
```typescript
{
  id: messageId,
  from: emailFrom,
  subject: emailSubject,
  date: emailDate,
  snippet: emailSnippet,
  pdfAttachments: [
    {
      filename: "work-order.pdf",
      mimeType: "application/pdf",
      data: Buffer // PDF file content
    }
  ]
}
```

---

## 2. When Python OCR Tool is Used

### Decision Logic

The system uses a **two-stage extraction approach** with a clear decision point:

#### Stage 1: Digital Text Extraction (Always Attempted First)

**Method**: Extract text directly from PDF using `pdf-parse` library

**Code Location**: `lib/workOrders/signedProcessor.ts` (lines 682-703)

```typescript
// Step 1: Attempt digital text extraction first
let digitalText: string = "";
let digitalCandidates: string[] = [];

try {
  digitalText = await extractTextFromPdfBuffer(pdfBuffer);
  if (digitalText && digitalText.trim().length > 0) {
    // Extract candidates from digital text
    digitalCandidates = extractCandidatesFromText(digitalText, expectedDigits);
  }
} catch (error) {
  // Digital text extraction failed - will fall back to OCR
}
```

**What It Does:**
- Extracts text directly from PDF's text layer (if present)
- Searches for work order number patterns (e.g., 7-digit numbers)
- Validates candidates match expected format (e.g., 7 digits)

**Success Criteria:**
- Digital text extraction succeeds AND
- At least one valid candidate is found (matches expected digit count)

#### Stage 2: Python OCR Service (Used When Digital Fails)

**Decision Point**: `shouldSkipOcr` flag

```typescript
// THIS is the only "digital works" indicator:
const shouldSkipOcr = validDigitalCandidates.length > 0;

if (shouldSkipOcr) {
  // Use digital text extraction - skip OCR
  digitalExtractionMethod = "DIGITAL_TEXT";
} else {
  // Digital failed - use Python OCR service
  // Call callSignedOcrService()
}
```

**When Python OCR is Used:**
- ✅ Digital text extraction returns empty text (scanned PDF, image-based PDF)
- ✅ Digital text extraction fails (corrupted PDF, parsing error)
- ✅ Digital text extraction succeeds but finds NO valid candidates

**When Python OCR is NOT Used:**
- ❌ Digital text extraction succeeds AND finds valid candidate(s)

**Code Location**: `lib/workOrders/signedOcr.ts` - `callSignedOcrService()`

**Python OCR Service Details:**
- **Endpoint**: `POST /v1/ocr/workorder-number/upload`
- **Input**: PDF buffer + template crop coordinates (PDF points)
- **Output**: Work order number, confidence score, raw text, snippet image URL
- **Method**: Uses FastAPI service with local OCR or Google Vision fallback

**Request Format:**
```typescript
FormData {
  templateId: string,
  page: number (1-based),
  dpi: number (default 200),
  xPt: number,      // Crop region in PDF points
  yPt: number,
  wPt: number,
  hPt: number,
  pageWidthPt: number,
  pageHeightPt: number,
  file: Blob (PDF buffer)
}
```

**Response Format:**
```typescript
{
  workOrderNumber: string | null,
  confidence: number (0..1),
  rawText: string,
  templateId: string,
  page: number,
  usedVisionFallback: boolean,
  method: "local" | "vision",
  snippetImageUrl?: string | null
}
```

### Multiple OCR Attempts

The system may make **multiple OCR attempts** for reliability:

1. **Primary Attempt**: OCR on template's configured page
2. **Retry Attempt**: If primary fails or confidence is low, retry with adjusted parameters
3. **Alternate Page**: If configured page fails, try alternate pages (if configured)

**Code Location**: `lib/workOrders/signedProcessor.ts` (lines 936-1200)

**Best Attempt Selection:**
- Filters attempts to only valid work order numbers
- Selects attempt with highest confidence score
- Falls back to highest confidence if no valid attempts

---

## 3. How It Gets a "Pass"

### Pass Agreement Definition

**Pass Agreement** means that **multiple OCR attempts agree on the same work order number**. This indicates consistency and reliability.

**Calculation:**
```typescript
// Normalize all OCR attempts to digits-only
const ocrWoNumbers = ocrAttempts
  .map(a => a.woNumber ? a.woNumber.replace(/\D/g, "") : "")
  .filter(n => n && n.length === expectedDigits);

// Get unique work order numbers
const uniqueOcrWos = Array.from(new Set(ocrWoNumbers));

// Pass agreement: at least 2 valid OCR reads that agree
const passAgreement = uniqueOcrWos.length === 1 && ocrWoNumbers.length >= 2;
```

**Code Location**: `lib/workOrders/signedProcessor.ts` (lines 1265-1273)

### Pass Agreement Requirements

For `passAgreement = true`:
1. **At least 2 OCR attempts** must have been made
2. **All valid attempts** must extract the **same work order number** (after normalization)
3. **All attempts** must pass format validation (correct digit count)

**Example Scenarios:**

✅ **Pass Agreement = TRUE:**
- Attempt 1: "1234567" (confidence: 0.85)
- Attempt 2: "1234567" (confidence: 0.90)
- Result: `passAgreement = true` (both agree on same number)

✅ **Pass Agreement = TRUE (with normalization):**
- Attempt 1: "WO 1234567" → normalized to "1234567"
- Attempt 2: "1234567 " → normalized to "1234567"
- Result: `passAgreement = true` (normalized values match)

❌ **Pass Agreement = FALSE:**
- Attempt 1: "1234567" (confidence: 0.85)
- Attempt 2: "1234568" (confidence: 0.90)
- Result: `passAgreement = false` (different numbers)

❌ **Pass Agreement = FALSE:**
- Attempt 1: "1234567" (confidence: 0.85)
- Result: `passAgreement = false` (only 1 attempt, need at least 2)

### Pass Agreement Impact on Trust Score

Pass agreement significantly boosts the trust score in the decision engine:

**Trust Score Calculation:**
- **Base Score**: 60 points (when exactly one valid candidate exists)
- **Pass Agreement Bonus**: +20 points (indicates consistency)
- **High Confidence Bonus**: +15 points (if confidence >= 0.9)
- **Medium Confidence Bonus**: +5 points (if confidence 0.6-0.89)
- **Low Confidence Penalty**: -15 points (if confidence < 0.6, **unless passAgreement is true**)

**Code Location**: `lib/workOrders/signedDecisionEngine.ts` - `scoreCandidate()`

**Example:**
```
Base: 60
+ Pass Agreement: +20
+ Medium Confidence: +5
= Total: 85 points → AUTO_CONFIRMED (>= 80)
```

**Key Insight**: Pass agreement can **override low confidence penalties**. If two OCR passes agree, even with low confidence, the system trusts the result more than a single high-confidence read.

### Decision States

The decision engine uses pass agreement along with other signals to determine one of three states:

1. **AUTO_CONFIRMED** (trustScore >= 80)
   - High confidence, can be automatically processed
   - Often includes pass agreement or high confidence

2. **QUICK_CHECK** (trustScore 60-79)
   - Medium confidence, needs quick human verification
   - May include pass agreement with medium confidence

3. **NEEDS_ATTENTION** (trustScore < 60)
   - Low confidence or issues, requires manual review
   - No pass agreement or multiple conflicting candidates

**Code Location**: `lib/workOrders/signedDecisionEngine.ts` - `decideSignedWorkOrder()`

---

## Complete Processing Flow Diagram

```
┌─────────────────────────────────────┐
│  Gmail Email Discovery              │
│  - Search for label + PDFs          │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Extract PDF from Gmail             │
│  - Download PDF buffer              │
│  - Extract metadata                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Stage 1: Digital Text Extraction   │
│  - Extract text from PDF            │
│  - Find work order candidates       │
│  - Validate format                  │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │             │
   Found valid    No valid
   candidates?    candidates?
        │             │
        ▼             ▼
┌──────────────┐ ┌─────────────────────┐
│ Use Digital  │ │ Stage 2: Python OCR  │
│ Text Result  │ │ - Call OCR service   │
│              │ │ - Multiple attempts  │
│ SKIP OCR     │ │ - Get confidence     │
└──────────────┘ └──────────┬───────────┘
                            │
                            ▼
                   ┌─────────────────────┐
                   │ Calculate Pass       │
                   │ Agreement            │
                   │ - Compare attempts   │
                   │ - Check consistency  │
                   └──────────┬───────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │ Decision Engine     │
                   │ - Calculate score    │
                   │ - Determine state    │
                   │ - Apply automation   │
                   └──────────┬───────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
          ┌─────────────────┐ ┌─────────────────┐
          │ AUTO_CONFIRMED  │ │ QUICK_CHECK /    │
          │ (auto-update)   │ │ NEEDS_ATTENTION  │
          └─────────────────┘ └─────────────────┘
```

---

## Key Decision Points Summary

### 1. Gmail PDF Discovery
- **Trigger**: Email has work orders label + PDF attachment
- **Action**: Extract PDF buffer from Gmail API
- **Code**: `lib/google/gmail.ts`

### 2. Digital vs OCR Decision
- **Try Digital First**: Always attempt digital text extraction
- **Use OCR If**: Digital fails OR finds no valid candidates
- **Decision Flag**: `shouldSkipOcr = validDigitalCandidates.length > 0`
- **Code**: `lib/workOrders/signedProcessor.ts` (line 915)

### 3. Pass Agreement Calculation
- **Requires**: At least 2 OCR attempts
- **Condition**: All valid attempts agree on same work order number
- **Formula**: `uniqueOcrWos.length === 1 && ocrWoNumbers.length >= 2`
- **Code**: `lib/workOrders/signedProcessor.ts` (line 1273)

### 4. Trust Score & Automation
- **Pass Agreement Bonus**: +20 points
- **Thresholds**: 
  - AUTO_CONFIRMED: >= 80
  - QUICK_CHECK: 60-79
  - NEEDS_ATTENTION: < 60
- **Code**: `lib/workOrders/signedDecisionEngine.ts`

---

## Code References

### Gmail PDF Extraction
- `lib/google/gmail.ts` - `listWorkOrderEmails()` - Search for emails
- `lib/google/gmail.ts` - `getEmailWithPdfAttachments()` - Extract PDFs
- `app/api/gmail/process/route.ts` - Gmail processing endpoint

### Digital Text Extraction
- `lib/workOrders/aiParser.ts` - `extractTextFromPdfBuffer()` - PDF text extraction
- `lib/workOrders/signedProcessor.ts` (lines 682-703) - Digital extraction logic

### Python OCR Service
- `lib/workOrders/signedOcr.ts` - `callSignedOcrService()` - OCR API call
- `lib/workOrders/signedProcessor.ts` (lines 940-1200) - OCR attempt logic

### Pass Agreement
- `lib/workOrders/signedProcessor.ts` (lines 1265-1273) - Pass agreement calculation
- `lib/workOrders/signedDecisionEngine.ts` - Trust score calculation

### Decision Engine
- `lib/workOrders/signedDecisionEngine.ts` - `decideSignedWorkOrder()` - Main decision logic
- `lib/workOrders/signedProcessor.ts` (lines 1252-1287) - Decision input preparation

---

## Environment Variables

```bash
# Python OCR Service URL (required for OCR functionality)
SIGNED_OCR_SERVICE_URL=http://localhost:8000

# Gmail label configuration (optional, has defaults)
GMAIL_WORK_ORDERS_LABEL_NAME="Work Orders/To Process"
```

---

## Notes

- **Digital text extraction is always attempted first** - it's faster and more reliable when available
- **Python OCR is only used when digital extraction fails** - this reduces API calls and processing time
- **Pass agreement requires at least 2 attempts** - single OCR reads never get pass agreement
- **Pass agreement can override low confidence** - consistency is valued over single high-confidence reads
- **Multiple OCR attempts improve reliability** - the system may retry with different parameters or pages
- **Decision engine is deterministic** - same inputs always produce same outputs

