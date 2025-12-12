/**
 * AI-powered parser for extracting WorkOrder data from EmailMessages.
 *
 * PDF text extraction:
 * - Tries pdf-parse first (fast when it works)
 * - Falls back to pdfjs-dist LEGACY build (most reliable on Vercel/serverless)
 * - Disables worker usage (workers commonly break in serverless)
 *
 * Notes for Next.js/Vercel:
 * - Avoid dynamic require(...) expressions (causes "Critical dependency" build warnings)
 * - pdfjs-dist@5.x legacy build is ESM (.mjs), so load via import()
 */

import type { WorkOrderInput } from "./types";
import type { EmailMessage, EmailAttachment } from "@/lib/emailMessages/types";
import {
  isAiParsingEnabled,
  getAiModelName,
  getIndustryProfile,
} from "@/lib/config/ai";

import OpenAI from "openai";

type PdfJsTextContentItem = {
  str?: string;
  [key: string]: any;
};

/**
 * pdfjs-dist@5.x uses ESM and the legacy build is .mjs
 * Force a real runtime import() even when this file is compiled to CJS in prod.
 * This prevents bundlers from converting import() to require() which causes ERR_REQUIRE_ESM.
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
  if (!buffer || buffer.length < 10) {
    throw new Error(
      `PDF_BUFFER_EMPTY_OR_TOO_SMALL (size=${buffer?.length ?? 0})`
    );
  }

  const header = buffer.subarray(0, 5).toString("utf8");
  if (header !== "%PDF-") {
    throw new Error(`NOT_A_PDF_BUFFER (header=${JSON.stringify(header)})`);
  }

  // 1) Try pdf-parse (fast path) - use dynamic import to avoid ESM/CJS issues
  try {
    // Use Function constructor to create a runtime import() that bundlers cannot rewrite
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<any>;
    const pdfParseMod = await importer("pdf-parse");
    
    // pdf-parse is CommonJS, so it might be in default or as a named export
    const pdfParseFn: any = pdfParseMod?.default ?? pdfParseMod?.pdfParse ?? pdfParseMod;
    
    if (typeof pdfParseFn === "function") {
      const data = await pdfParseFn(buffer);
      const text = (data?.text ?? "").trim();
      if (text) return text;
    }
  } catch (err) {
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
  scheduled_date: string;
  priority: string;
  amount: string;
  currency: string;
  nte_amount: string;
  service_category: string;
  facility_id: string;
  notes: string;
};

type AiParserResponse = {
  workOrders: AiWorkOrder[];
};

/**
 * Load PDF file into a Buffer from attachment storage location.
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

function getEmailBody(_email: EmailMessage): string {
  return "";
}

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

EMAIL SUBJECT:
${email.subject}

EMAIL BODY:
${emailBody || "(Email body not available)"}

PDF TEXT:
${pdfText || "(No PDF text available)"}

RETURN JSON EXACTLY IN THIS FORMAT:

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

Return ONLY JSON.`;
}

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

export async function getPdfTextFromAttachmentForDebug(
  attachment: EmailAttachment
): Promise<string> {
  return getPdfTextFromAttachment(attachment);
}
