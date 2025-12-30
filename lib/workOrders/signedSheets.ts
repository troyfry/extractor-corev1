import { createSheetsClient, formatSheetRange, getSheetHeadersCached, findRowIndexByColumnValue } from "@/lib/google/sheets";
import { getColumnRange } from "@/lib/google/sheetsCache";

export const SIGNED_NEEDS_REVIEW_SHEET_NAME = "Needs_Review_Signed" as const;

export const SIGNED_NEEDS_REVIEW_COLUMNS = [
  "review_id",
  "created_at",
  "fmKey",
  "signed_pdf_url",
  "preview_image_url",
  "raw_text",
  "confidence",
  "reason",
  "manual_work_order_number",
  "resolved",
  "resolved_at",
  "reason_note",
  "file_hash",
  "source",
  "gmail_message_id",
  "gmail_attachment_id",
  "gmail_subject",
  "gmail_from",
  "gmail_date",
  // Phase 3: Decision metadata
  "decision_state",
  "trust_score",
  "decision_reasons",
  "normalized_candidates",
  "extraction_method",
  "ocr_pass_agreement",
  "ocr_confidence_raw",
  "chosen_candidate",
  // Phase 3: Verified by human
  "wo_verified",
  "wo_verified_at",
  "wo_verified_value",
  "wo_verified_by",
  // Phase 3: Idempotency
  "review_dedupe_key",
] as const;

export type SignedNeedsReviewRecord = {
  review_id?: string | null;
  created_at?: string | null;
  fmKey: string | null;
  signed_pdf_url: string | null;
  preview_image_url: string | null;
  raw_text: string | null;
  confidence: "high" | "medium" | "low" | "unknown" | null;
  reason: string | null;
  manual_work_order_number: string | null;
  resolved: string | null;
  resolved_at: string | null;
  reason_note?: string | null;
  file_hash?: string | null; // Hash of the PDF file for deduplication
  source?: "UPLOAD" | "GMAIL" | null;
  gmail_message_id?: string | null;
  gmail_attachment_id?: string | null;
  gmail_subject?: string | null;
  gmail_from?: string | null;
  gmail_date?: string | null;
  // Phase 3: Decision metadata
  decision_state?: "AUTO_CONFIRMED" | "QUICK_CHECK" | "NEEDS_ATTENTION" | null;
  trust_score?: number | null;
  decision_reasons?: string | null; // Pipe-separated: "OK_FORMAT|DIGITAL_TEXT_STRONG"
  normalized_candidates?: string | null; // Pipe-separated: "1234567|1234568"
  extraction_method?: "DIGITAL_TEXT" | "OCR" | null;
  ocr_pass_agreement?: "TRUE" | "FALSE" | null;
  ocr_confidence_raw?: number | null; // 0..1
  chosen_candidate?: string | null;
  // Phase 3: Verified by human
  wo_verified?: "TRUE" | "FALSE" | null;
  wo_verified_at?: string | null; // ISO string
  wo_verified_value?: string | null;
  wo_verified_by?: string | null;
  // Phase 3: Idempotency
  review_dedupe_key?: string | null;
};

/**
 * Ensure the Needs_Review_Signed sheet exists and has all required columns.
 * If columns are missing from the header row, they are appended.
 */
export async function ensureSignedNeedsReviewColumnsExist(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;

  // Get current header row
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const existingHeaders = (headerResponse.data.values?.[0] || []) as string[];
  const existingLower = existingHeaders.map((h) => h.toLowerCase().trim());

  const missing: string[] = [];
  for (const col of SIGNED_NEEDS_REVIEW_COLUMNS) {
    if (!existingLower.includes(col.toLowerCase())) {
      missing.push(col);
    }
  }

  if (missing.length === 0) {
    return;
  }

  const updatedHeaders = [...existingHeaders, ...missing];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
    valueInputOption: "RAW",
    requestBody: {
      values: [updatedHeaders],
    },
  });

  console.log(
    `[Sheets] Added missing columns on ${sheetName}: ${missing.join(", ")}`
  );
}

/**
 * Check if a Needs_Review_Signed row with the given dedupe key already exists.
 * Returns true if a duplicate exists, false otherwise.
 */
export async function findSignedNeedsReviewByDedupeKey(
  accessToken: string,
  spreadsheetId: string,
  dedupeKey: string
): Promise<boolean> {
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;
  
  try {
    const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, sheetName);
    const dedupeKeyLetter = headerMeta.colLetterByLower["review_dedupe_key"];
    
    if (!dedupeKeyLetter) {
      // Column doesn't exist yet, so no duplicates possible
      return false;
    }
    
    const rowIndex = await findRowIndexByColumnValue(
      accessToken,
      spreadsheetId,
      sheetName,
      dedupeKeyLetter,
      dedupeKey
    );
    
    return rowIndex !== -1;
  } catch (error) {
    // If lookup fails, allow append (fail open)
    console.warn("[Signed Sheets] Error checking for duplicate dedupe key:", error);
    return false;
  }
}

/**
 * Append a row to the Needs_Review_Signed sheet.
 * Phase 3: Includes idempotency check to prevent duplicates.
 */
export async function appendSignedNeedsReviewRow(
  accessToken: string,
  spreadsheetId: string,
  record: SignedNeedsReviewRecord
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;

  // Make sure headers/columns exist first
  await ensureSignedNeedsReviewColumnsExist(accessToken, spreadsheetId);
  
  // Phase 3: Idempotency check - skip if duplicate exists
  if (record.review_dedupe_key) {
    const exists = await findSignedNeedsReviewByDedupeKey(
      accessToken,
      spreadsheetId,
      record.review_dedupe_key
    );
    if (exists) {
      console.log("[Signed Sheets] Skipping append - duplicate dedupe key found:", record.review_dedupe_key);
      return;
    }
  }

  // Fetch headers to align fields to columns
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  const rowData = new Array(headers.length).fill("");

  const toMap: Record<string, string | null> = {
    review_id: record.review_id || null,
    created_at: record.created_at || null,
    fmKey: record.fmKey,
    signed_pdf_url: record.signed_pdf_url,
    preview_image_url: record.preview_image_url,
    raw_text: record.raw_text,
    confidence: record.confidence,
    reason: record.reason,
    manual_work_order_number: record.manual_work_order_number,
    resolved: record.resolved,
    resolved_at: record.resolved_at,
    reason_note: record.reason_note || null,
    file_hash: record.file_hash || null,
    source: record.source || null,
    gmail_message_id: record.gmail_message_id || null,
    gmail_attachment_id: record.gmail_attachment_id || null,
    gmail_subject: record.gmail_subject || null,
    gmail_from: record.gmail_from || null,
    gmail_date: record.gmail_date || null,
    // Phase 3: Decision metadata
    decision_state: record.decision_state || null,
    trust_score: record.trust_score != null ? String(record.trust_score) : null,
    decision_reasons: record.decision_reasons || null,
    normalized_candidates: record.normalized_candidates || null,
    extraction_method: record.extraction_method || null,
    ocr_pass_agreement: record.ocr_pass_agreement || null,
    ocr_confidence_raw: record.ocr_confidence_raw != null ? String(record.ocr_confidence_raw) : null,
    chosen_candidate: record.chosen_candidate || null,
    // Phase 3: Verified by human
    wo_verified: record.wo_verified || null,
    wo_verified_at: record.wo_verified_at || null,
    wo_verified_value: record.wo_verified_value || null,
    wo_verified_by: record.wo_verified_by || null,
    // Phase 3: Idempotency
    review_dedupe_key: record.review_dedupe_key || null,
  };

  for (const [key, value] of Object.entries(toMap)) {
    const idx = headersLower.indexOf(key.toLowerCase());
    if (idx === -1) {
      console.warn(`[Signed Sheets] Column "${key}" not found in headers:`, headers);
      continue;
    }
    // Ensure value is always a string (handle null/undefined)
    rowData[idx] = value != null ? String(value) : "";
  }

  console.log("[Signed Sheets] Row data being appended:", {
    fmKey: record.fmKey,
    raw_text_length: record.raw_text?.length || 0,
    raw_text_preview: record.raw_text?.substring(0, 50) || "",
    has_raw_text: !!record.raw_text,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, getColumnRange(SIGNED_NEEDS_REVIEW_COLUMNS.length)),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log("[Sheets] Appended Needs_Review_Signed row");
}

/**
 * Find a Needs_Review_Signed row by review_id using column-only reads.
 */
export async function findSignedNeedsReviewRowById(
  accessToken: string,
  spreadsheetId: string,
  reviewId: string
): Promise<{ rowIndex: number; rowData: string[] } | null> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;

  // Get headers to find review_id column
  const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, sheetName);
  const reviewIdLetter = headerMeta.colLetterByLower["review_id"];
  
  if (!reviewIdLetter) {
    console.warn("[Signed Sheets] review_id column not found");
    return null;
  }

  // Find row index by reading only the review_id column
  const rowIndex = await findRowIndexByColumnValue(
    accessToken,
    spreadsheetId,
    sheetName,
    reviewIdLetter,
    reviewId
  );

  if (rowIndex === -1) {
    return null;
  }

  // Read the specific row
  const rowResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
  });

  const rowData = (rowResponse.data.values?.[0] || []) as string[];
  return { rowIndex, rowData };
}

/**
 * Mark a Needs_Review_Signed row as resolved.
 */
export async function markSignedNeedsReviewResolved(
  accessToken: string,
  spreadsheetId: string,
  reviewId: string,
  woNumber: string,
  reasonNote?: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;

  // Find the row
  const found = await findSignedNeedsReviewRowById(accessToken, spreadsheetId, reviewId);
  if (!found) {
    throw new Error(`Review row not found: ${reviewId}`);
  }

  // Get headers to map fields
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => (h || "").toLowerCase().trim());

  // Update row data
  const rowData = [...found.rowData];
  const nowIso = new Date().toISOString();

  const resolvedIdx = headersLower.indexOf("resolved");
  const resolvedAtIdx = headersLower.indexOf("resolved_at");
  const manualWoIdx = headersLower.indexOf("manual_work_order_number");
  const reasonNoteIdx = headersLower.indexOf("reason_note");

  if (resolvedIdx >= 0) rowData[resolvedIdx] = "TRUE";
  if (resolvedAtIdx >= 0) rowData[resolvedAtIdx] = nowIso;
  if (manualWoIdx >= 0) rowData[manualWoIdx] = woNumber;
  if (reasonNoteIdx >= 0 && reasonNote) rowData[reasonNoteIdx] = reasonNote;

  // Update the row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${found.rowIndex}:${found.rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Signed Sheets] Marked review ${reviewId} as resolved`);
}

/**
 * Update a Needs_Review_Signed row with manual WO number but keep resolved FALSE.
 */
export async function updateSignedNeedsReviewUnresolved(
  accessToken: string,
  spreadsheetId: string,
  reviewId: string,
  woNumber: string,
  reason: string,
  reasonNote?: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = SIGNED_NEEDS_REVIEW_SHEET_NAME;

  // Find the row
  const found = await findSignedNeedsReviewRowById(accessToken, spreadsheetId, reviewId);
  if (!found) {
    throw new Error(`Review row not found: ${reviewId}`);
  }

  // Get headers to map fields
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => (h || "").toLowerCase().trim());

  // Update row data
  const rowData = [...found.rowData];

  const manualWoIdx = headersLower.indexOf("manual_work_order_number");
  const reasonIdx = headersLower.indexOf("reason");
  const reasonNoteIdx = headersLower.indexOf("reason_note");

  if (manualWoIdx >= 0) rowData[manualWoIdx] = woNumber;
  if (reasonIdx >= 0) rowData[reasonIdx] = reason;
  if (reasonNoteIdx >= 0 && reasonNote) rowData[reasonNoteIdx] = reasonNote;

  // Update the row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${found.rowIndex}:${found.rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Signed Sheets] Updated review ${reviewId} with manual WO but kept unresolved`);
}

