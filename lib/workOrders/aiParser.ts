/**
 * AI-powered parser for extracting WorkOrder data from EmailMessages.
 *
 * PDF text extraction uses pdf-parse only (stable on Vercel/Next.js serverless).
 * Scanned/image-only PDFs will fail cleanly with EMPTY_TEXT_FROM_PDF error.
 */

import type { WorkOrderInput } from "./types";
import type { EmailMessage, EmailAttachment } from "@/lib/emailMessages/types";
import {
  isAiParsingEnabled,
  getAiModelName,
  getIndustryProfile,
} from "@/lib/config/ai";

import OpenAI from "openai";
console.log("[aiParser] LOADED - VERSION: CLEAN-PARSE-ONLY");

/**
 * Extract text from a PDF Buffer using pdf-parse.
 * pdf-parse is CommonJS and stable on Vercel serverless functions.
 */
export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length < 10) {
    throw new Error(`PDF_BUFFER_EMPTY_OR_TOO_SMALL (size=${buffer?.length ?? 0})`);
  }

  const header = buffer.subarray(0, 5).toString("utf8");
  if (header !== "%PDF-") {
    throw new Error(`NOT_A_PDF_BUFFER (header=${JSON.stringify(header)})`);
  }

  // pdf-parse is CommonJS and stable on Vercel
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = require("pdf-parse");
  const parseFn =
    typeof pdfParse === "function" ? pdfParse : pdfParse.default ?? pdfParse;

  const data = await parseFn(buffer);
  const text = (data?.text ?? "").trim();

  if (!text) {
    // Scanned / image-only PDF (no text layer)
    throw new Error("EMPTY_TEXT_FROM_PDF (likely scanned/image-only PDF)");
  }
  console.log("[aiParser] extractTextFromPdfBuffer called - VERSION: CLEAN-PARSE-ONLY");

  return text;
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
