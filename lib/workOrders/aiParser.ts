/**
 * AI-powered parser for extracting WorkOrder data from EmailMessages.
 *
 * PDF text extraction:
 * - Tries pdf-parse first (fast when it works)
 * - Falls back to pdfjs-dist LEGACY build (most reliable on Vercel/serverless)
 * - Disables worker usage (workers commonly break in serverless)
 *
 * To enable AI parsing:
 * - npm install openai
 * - set OPENAI_API_KEY
 */

import type { WorkOrderInput } from "./types";
import type { EmailMessage, EmailAttachment } from "@/lib/emailMessages/types";
import {
  isAiParsingEnabled,
  getAiModelName,
  getIndustryProfile,
} from "@/lib/config/ai";

import OpenAI from "openai";

/**
 * Some deployments (Vercel) can behave differently depending on bundling.
 * Use dynamic require for Node-only dependencies.
 */
function safeRequire(mod: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const req =
    typeof require !== "undefined" ? require : new Function("return require")();
  return req(mod);
}

type PdfJsTextContentItem = {
  str?: string;
  [key: string]: any;
};

/**
 * pdfjs-dist@5.x uses ESM and the legacy build is .mjs
 * (pdf.js path commonly does not exist anymore).
 */
async function loadPdfJsLegacy() {
  return await import("pdfjs-dist/legacy/build/pdf.mjs");
}

/**
 * Extract text from a PDF Buffer.
 * - Validates PDF header
 * - Attempts pdf-parse
 * - Falls back to pdfjs-dist legacy build (disableWorker)
 */
export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  // Basic sanity checks help catch “upload arrived empty/corrupt” cases
  if (!buffer || buffer.length < 10) {
    throw new Error(
      `PDF_BUFFER_EMPTY_OR_TOO_SMALL (size=${buffer?.length ?? 0})`
    );
  }

  const header = buffer.subarray(0, 5).toString("utf8");
  if (header !== "%PDF-") {
    // This is the best indicator that the upload did not arrive as a real PDF.
    throw new Error(`NOT_A_PDF_BUFFER (header=${JSON.stringify(header)})`);
  }

  // 1) Try pdf-parse (if installed). It can be great, but sometimes fails in serverless.
  try {
    const pdfParse = safeRequire("pdf-parse");
    const pdfParseFn =
      typeof pdfParse === "function"
        ? pdfParse
        : pdfParse?.default ?? pdfParse;

    if (typeof pdfParseFn === "function") {
      const data = await pdfParseFn(buffer);
      const text = (data?.text ?? "").trim();
      if (text) return text;
      // If pdf-parse returns empty, fall through to pdfjs-dist.
    }
  } catch (err) {
    // Don’t fail yet; pdfjs fallback is usually more reliable.
    console.warn(
      "[PDF] pdf-parse failed, falling back to pdfjs-dist legacy:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // 2) Fallback to pdfjs-dist legacy build (Node/serverless friendly)
  try {
    const pdfjsMod: any = await loadPdfJsLegacy();
    const pdfjsLib: any = pdfjsMod?.default ?? pdfjsMod;

    // Disable worker (critical for serverless reliability)
    if (pdfjsLib?.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
    }

    // pdfjs expects Uint8Array
    const data = new Uint8Array(buffer);

    const loadingTask = pdfjsLib.getDocument({
      data,
      disableWorker: true,
      stopAtErrors: false,
      verbosity: 0,
    });

    const pdf = await loadingTask.promise;

    let fullText = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const pageText = (content.items as PdfJsTextContentItem[])
        .map((item) => item?.str ?? "")
        .filter(Boolean)
        .join(" ");

      fullText += pageText + "\n\n";
    }

    const trimmed = fullText.trim();
    if (!trimmed) {
      // Most commonly: scanned/image-only PDF (no embedded text)
      throw new Error("EMPTY_TEXT_FROM_PDF (likely scanned/image-only PDF)");
    }

    return trimmed;
  } catch (err) {
    const details =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };

    console.error(
      "[PDF] PDF parsing failed (pdf-parse + pdfjs-dist legacy):",
      details
    );

    throw new Error(
      `PDF parsing failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * AI response structure for work order extraction.
 */
type AiWorkOrder = {
  work_order_number: string;
  customer_name: string;
  vendor_name: string;
  service_address: string;
  job_type: string;
  job_description: string;
  scheduled_date: string; // ISO format
  priority: string;
  amount: string; // numeric only, no currency symbols
  currency: string; // e.g., "USD"
  nte_amount: string; // Not To Exceed amount
  service_category: string;
  facility_id: string;
  notes: string;
};

type AiParserResponse = {
  workOrders: AiWorkOrder[];
};

/**
 * Load PDF file into a Buffer from attachment storage location.
 * Supports:
 * - HTTP/HTTPS URLs
 * - Local filesystem paths (useful locally; may not exist on Vercel)
 */
async function getPdfBufferFromAttachment(
  attachment: EmailAttachment
): Promise<Buffer | null> {
  const loc = attachment.storageLocation;

  if (!loc) {
    console.warn("[PDF] No storageLocation for attachment:", attachment.filename);
    return null;
  }

  try {
    if (loc.startsWith("http://") || loc.startsWith("https://")) {
      const res = await fetch(loc);
      if (!res.ok) {
        console.error(
          "[PDF] Failed to fetch remote PDF:",
          loc,
          res.status,
          res.statusText
        );
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    // Local filesystem read (works locally; may fail in serverless)
    try {
      const fs = await import("node:fs/promises");
      return await fs.readFile(loc);
    } catch (fsErr) {
      console.error(
        "[PDF] Failed reading local PDF path (likely serverless):",
        loc,
        fsErr
      );
      return null;
    }
  } catch (err) {
    console.error("[PDF] Error loading PDF:", loc, err);
    return null;
  }
}

/**
 * Extract text content from a PDF attachment.
 * Returns a string and never throws.
 */
async function getPdfTextFromAttachment(
  attachment: EmailAttachment
): Promise<string> {
  const buffer = await getPdfBufferFromAttachment(attachment);

  if (!buffer) {
    return `UNAVAILABLE_PDF_CONTENT: Could not load PDF for attachment "${attachment.filename}".`;
  }

  try {
    return await extractTextFromPdfBuffer(buffer);
  } catch (err) {
    console.error("[PDF] Error parsing PDF for attachment:", attachment.filename, err);
    return `UNAVAILABLE_PDF_CONTENT: Error parsing PDF for attachment "${attachment.filename}".`;
  }
}

/**
 * Get email body text placeholder.
 */
function getEmailBody(_email: EmailMessage): string {
  return "";
}

/**
 * Build the extraction prompt for OpenAI.
 */
function buildExtractionPrompt(
  email: EmailMessage,
  pdfTexts: { filename: string; text: string }[]
): string {
  const profile = getIndustryProfile();
  const emailBody = getEmailBody(email);

  const pdfText = pdfTexts
    .map((pdf, idx) => `--- PDF ${idx + 1}: ${pdf.filename} ---\n${pdf.text}\n`)
    .join("\n\n");

  const examplesSection = profile.examples ? `\n\n${profile.examples}\n` : "";

  return `You are a highly accurate Work Order Extraction Engine specialized in ${profile.label}.${examplesSection}

Your task is to extract structured job data from THREE sources combined:

1) Email SUBJECT
2) Email BODY
3) PDF TEXT

Work orders may vary in wording, formatting, layout, and phrasing.
You must merge information from all sources and produce a single, consistent JSON object.

-----------------------
RULES (follow strictly)
-----------------------

1. OUTPUT FORMAT
   - Return ONLY valid JSON.
   - No explanations, no text outside the JSON object.

2. MISSING FIELDS
   - If a field is not present, return an empty string "".

3. DATES
   - Normalize all dates into ISO format: YYYY-MM-DD whenever possible.
   - If ambiguous, choose the most clearly stated scheduled date.
   - Do NOT invent dates.
   - If no date is found, use the email received date: ${email.receivedAt}

4. AMOUNTS
   - For "amount" and "nte_amount", extract ONLY numeric characters.
     Example: "$125.00 NTE" → "125"
     Example: "NTE $400.00" → "400"
   - If "amount" is not found but "nte_amount" is present,
     extract the NTE value to BOTH "amount" and "nte_amount" fields.
   - If no numeric value is found, return "".

5. DO NOT GUESS
   - Only extract what is explicitly stated in the subject, email body, or PDF.

6. MERGE ALL SOURCES
   - Prefer canonical PDF fields when contradictions occur.

7. VENDOR/FACILITY MANAGEMENT COMPANY
   - Extract "vendor_name" as the FACILITY MANAGEMENT COMPANY/PLATFORM issuing the work order.
   - This is NOT the contractor/service provider doing the work.
   - If not found, return "".

-----------------------
INPUT DATA
-----------------------

EMAIL SUBJECT:
${email.subject}

EMAIL BODY:
${emailBody || "(Email body not available)"}

PDF TEXT:
${pdfText || "(No PDF text available)"}

-----------------------
RETURN JSON EXACTLY IN THIS FORMAT:
-----------------------

{
  "workOrders": [
    {
      "work_order_number": "",
      "customer_name": "",
      "vendor_name": "",
      "service_address": "",
      "job_type": "",
      "job_description": "",
      "scheduled_date": "",
      "priority": "",
      "amount": "",
      "currency": "USD",
      "nte_amount": "",
      "service_category": "",
      "facility_id": "",
      "notes": ""
    }
  ]
}

IMPORTANT: Return ONLY the JSON object, no markdown, no code blocks, no explanations.`;
}

/**
 * Parse OpenAI JSON response into WorkOrderInput[] (without userId).
 */
function parseAiResponse(
  responseText: string,
  email: EmailMessage
): Omit<WorkOrderInput, "userId">[] | null {
  try {
    let jsonText = responseText.trim();
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (codeBlockMatch) jsonText = codeBlockMatch[1];

    const parsed = JSON.parse(jsonText) as AiParserResponse;

    if (!parsed.workOrders || !Array.isArray(parsed.workOrders)) {
      console.error("AI response missing workOrders array");
      return null;
    }

    if (parsed.workOrders.length === 0) return [];

    const sanitizeAmountString = (amountStr: string | null | undefined): string | null => {
      if (!amountStr || typeof amountStr !== "string") return null;
      const sanitized = amountStr.replace(/[^0-9.]/g, "");
      if (!sanitized || sanitized === ".") return null;
      const num = parseFloat(sanitized);
      return Number.isNaN(num) ? null : num.toFixed(2);
    };

    return parsed.workOrders.map((wo) => {
      const amount = sanitizeAmountString(wo.amount || wo.nte_amount);

      const notes = [wo.notes, wo.nte_amount ? `NTE: ${wo.nte_amount}` : null]
        .filter(Boolean)
        .join(" | ");

      return {
        workOrderNumber: wo.work_order_number || `UNKNOWN-${email.id.slice(0, 8)}`,
        timestampExtracted: email.receivedAt,
        scheduledDate: wo.scheduled_date || email.receivedAt,
        serviceAddress: wo.service_address || null,
        jobType: wo.job_type || null,
        customerName: wo.customer_name || null,
        vendorName: wo.vendor_name || null,
        jobDescription: wo.job_description || null,
        amount,
        currency: wo.currency || "USD",
        notes: notes || null,
        priority: wo.priority || null,
        calendarEventLink: null,
        workOrderPdfLink: null,
      };
    });
  } catch (error) {
    console.error("Failed to parse AI response as JSON:", error);
    console.error("Response text:", responseText);
    return null;
  }
}

/**
 * Use AI to parse work orders from an email message.
 */
export async function aiParseWorkOrdersFromEmail(
  email: EmailMessage
): Promise<Omit<WorkOrderInput, "userId">[] | null> {
  if (!isAiParsingEnabled()) return null;

  try {
    const pdfAttachments = email.attachments.filter((att) =>
      att.mimeType.toLowerCase().includes("pdf")
    );

    if (pdfAttachments.length === 0) return null;

    const pdfTexts: { filename: string; text: string }[] = [];
    const MAX_CHARS_PER_PDF = 8000;

    for (const attachment of pdfAttachments) {
      const text = await getPdfTextFromAttachment(attachment);

      if (text.startsWith("UNAVAILABLE_PDF_CONTENT:")) {
        console.warn(`[AI Parser] Skipping PDF ${attachment.filename}: ${text}`);
        continue;
      }

      pdfTexts.push({
        filename: attachment.filename,
        text: text.slice(0, MAX_CHARS_PER_PDF),
      });
    }

    if (pdfTexts.length === 0) {
      console.error("No PDF text could be extracted");
      return null;
    }

    const prompt = buildExtractionPrompt(email, pdfTexts);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const model = getAiModelName();

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a highly accurate Work Order Extraction Engine. Always respond with valid JSON only, no explanations.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const responseText = response.choices[0]?.message?.content;
    if (!responseText) {
      console.error("Empty response from OpenAI");
      return null;
    }

    return parseAiResponse(responseText, email);
  } catch (error) {
    console.error("AI parsing failed for email:", email.id, {
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : error,
      emailId: email.id,
      subject: email.subject,
      attachmentCount: email.attachments.length,
    });
    return null;
  }
}

/**
 * Export for debug/testing purposes.
 */
export async function getPdfTextFromAttachmentForDebug(
  attachment: EmailAttachment
): Promise<string> {
  return getPdfTextFromAttachment(attachment);
}
