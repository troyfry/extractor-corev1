/**
 * AI-powered parser for extracting WorkOrder data from EmailMessages.
 * 
 * This module uses OpenAI to parse PDF content and extract structured work order
 * information. Falls back gracefully when AI is disabled or encounters errors.
 * 
 * PDF text extraction uses pdfjs-dist:
 * - Extracts text page-by-page using pure JavaScript
 * - Works reliably in Node.js runtime
 * 
 * To enable AI parsing, install:
 * npm install openai
 * 
 * And set OPENAI_API_KEY in your environment.
 */

import type { WorkOrderInput } from "./types";
import type { EmailMessage, EmailAttachment } from "@/lib/emailMessages/types";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import fs from "node:fs/promises";

// OpenAI import
import OpenAI from "openai";

// Type for text content items from pdfjs
type PdfJsTextContentItem = {
  str?: string;
  [key: string]: any;
};

/**
 * Extract text from a PDF Buffer using pdfjs-dist.
 * Uses a CommonJS helper to avoid webpack bundling issues.
 * 
 * @param buffer - PDF file as Buffer
 * @returns Extracted text content
 */
export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  // Try pdf-parse first (more reliable in Next.js)
  try {
    // @ts-ignore - require is available in Node.js runtime
    const nodeRequire = typeof require !== "undefined" 
      ? require 
      : new Function("return require")();
    
    // @ts-ignore
    const pdfParse = nodeRequire("pdf-parse");
    const pdfParseFn = typeof pdfParse === "function" ? pdfParse : (pdfParse.default || pdfParse);
    
    if (pdfParseFn && typeof pdfParseFn === "function") {
      const data = await pdfParseFn(buffer);
      const text = (data.text || "").trim();
      if (text) {
        return text;
      }
    }
  } catch (pdfParseError) {
    console.warn("[PDF] pdf-parse failed, trying pdfjs-dist:", pdfParseError instanceof Error ? pdfParseError.message : String(pdfParseError));
  }
  
  // Fallback to pdfjs-dist if pdf-parse fails
  try {
    // Load pdfjs-dist using require (Node.js runtime only)
    // @ts-ignore - require is available in Node.js runtime
    const nodeRequire = typeof require !== "undefined" 
      ? require 
      : new Function("return require")();
    
    // Load the CommonJS helper which loads pdfjs-dist
    // @ts-ignore - CommonJS require in ESM context
    const pdfjsLib: any = nodeRequire("./pdfLoader.js");
    
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
      throw new Error("Failed to load pdfjs-dist: getDocument not found");
    }
    
    // Configure pdfjs for Node.js environment if needed
    if (typeof globalThis !== "undefined" && !globalThis.navigator) {
      (globalThis as any).navigator = { userAgent: "node" };
    }

    // Convert Buffer to Uint8Array (pdfjs-dist requires Uint8Array, not Buffer)
    const uint8Array = new Uint8Array(buffer);

    // @ts-ignore - pdfjs-dist types are complex
    const loadingTask = pdfjsLib.getDocument({ 
      data: uint8Array,
      verbosity: 0,
    });
    // @ts-ignore - pdfjs-dist types
    const pdf = await loadingTask.promise;

    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const pageText = (content.items as PdfJsTextContentItem[])
        .map((item) => (item.str ?? ""))
        .join(" ");

      fullText += pageText + "\n\n";
    }

    const trimmed = fullText.trim();
    if (!trimmed) {
      throw new Error("EMPTY_TEXT_FROM_PDF");
    }

    return trimmed;
  } catch (pdfjsError) {
    // Both methods failed
    const errorDetails = pdfjsError instanceof Error ? {
      message: pdfjsError.message,
      stack: pdfjsError.stack,
      name: pdfjsError.name,
    } : { message: String(pdfjsError) };
    
    console.error("[PDF] PDF parsing error (tried pdf-parse and pdfjs-dist):", errorDetails);
    
    throw new Error(
      `PDF parsing failed (tried pdf-parse and pdfjs-dist): ${
        pdfjsError instanceof Error ? pdfjsError.message : String(pdfjsError)
      }`
    );
  }
}

/**
 * AI response structure for work order extraction.
 * Matches the prompt's expected JSON format.
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
 * Load PDF file into a Buffer from storage location.
 * 
 * Supports both local filesystem paths and HTTP/HTTPS URLs.
 * Returns null on any error instead of throwing.
 * 
 * @param attachment - EmailAttachment with storageLocation
 * @returns Buffer containing PDF data, or null if loading fails
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
      const buffer = Buffer.from(arrayBuffer);
      return buffer;
    } else {
      const buffer = await fs.readFile(loc);
      return buffer;
    }
  } catch (err) {
    console.error("[PDF] Error loading PDF:", loc, err);
    return null;
  }
}


/**
 * Extract text content from a PDF attachment.
 * 
 * Uses pdfjs-dist for page-by-page extraction (similar to PyPDF2 approach).
 * Returns a string (possibly empty) and never throws.
 * 
 * @param attachment - EmailAttachment with PDF mimeType
 * @returns Extracted text content from the PDF
 */
async function getPdfTextFromAttachment(
  attachment: EmailAttachment
): Promise<string> {
  const buffer = await getPdfBufferFromAttachment(attachment);

  if (!buffer) {
    return `UNAVAILABLE_PDF_CONTENT: Could not load PDF for attachment "${attachment.filename}".`;
  }

  try {
    const text = await extractTextFromPdfBuffer(buffer);
    return text;
  } catch (err) {
    console.error(
      "[PDF] Error parsing PDF for attachment:",
      attachment.filename,
      err
    );
    return `UNAVAILABLE_PDF_CONTENT: Error parsing PDF for attachment "${attachment.filename}".`;
  }
}



/**
 * Get email body text.
 * 
 * TODO: Add email body field to EmailMessage type and schema if not present.
 * For now, returns empty string as placeholder.
 * 
 * @param email - EmailMessage
 * @returns Email body text
 */
function getEmailBody(email: EmailMessage): string {
  // TODO: Add body field to EmailMessage type if not present
  // For now, return empty string
  // In the future: return email.body || "";
  return "";
}

/**
 * Build the prompt for OpenAI to extract work order data.
 * Uses a structured, rule-based prompt similar to production extraction engines.
 * 
 * @param email - EmailMessage with metadata
 * @param pdfTexts - Array of extracted PDF text content (one per PDF attachment)
 * @returns Prompt string for OpenAI
 */
function buildExtractionPrompt(
  email: EmailMessage,
  pdfTexts: { filename: string; text: string }[]
): string {
  const profile = getIndustryProfile();
  const emailBody = getEmailBody(email);
  
  // Combine all PDF texts
  const pdfText = pdfTexts
    .map((pdf, idx) => `--- PDF ${idx + 1}: ${pdf.filename} ---\n${pdf.text}\n`)
    .join("\n\n");

  const examplesSection = profile.examples
    ? `\n\n${profile.examples}\n`
    : "";

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
   - If "amount" is not found but "nte_amount" (Not To Exceed) is present,
     extract the NTE value to BOTH "amount" and "nte_amount" fields.
   - If no numeric value is found, return "".

5. DO NOT GUESS
   - Only extract what is explicitly stated in the subject, email body, or PDF.

6. MERGE ALL SOURCES
   - If a value appears in the subject but not in the PDF, use it.
   - If email body includes special notes or instructions, include them in "notes".
   - Prefer canonical PDF fields when contradictions occur.

7. VENDOR/FACILITY MANAGEMENT COMPANY
   - Extract "vendor_name" as the FACILITY MANAGEMENT COMPANY/PLATFORM that is sending/issuing the work order.
   - This is the work order management system or facility management platform (e.g., ServiceChannel, Corrigo, FMX, Hippo, ServiceTrade, etc.).
   - This is NOT the service provider/contractor doing the actual work (e.g., NOT the cleaning company, HVAC company, plumber, etc.).
   - This is different from "customer_name" (the job site/client/facility where work is being done).
   - Look for platform/system names in:
     * Email "From" field (if it's from a facility management platform)
     * PDF header/footer (often shows the platform name)
     * Work order system identifiers
   - Common facility management platforms: ServiceChannel, Corrigo, FMX, Hippo, ServiceTrade, Brightly, etc.
   - If you see a cleaning company, HVAC company, or other service provider name, that is NOT the vendor - that's the contractor/service provider.
   - If not found, return "".

8. INDUSTRY-SPECIFIC TERMINOLOGY
   - For "job_type" and "service_category", use terminology appropriate for ${profile.label}.
   - Extract job types and categories that are common in this industry context.

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
 * Parse OpenAI response and convert to WorkOrderInput[] (without userId).
 * 
 * Note: userId must be attached separately after calling this function.
 * 
 * @param responseText - Raw text response from OpenAI
 * @param email - Original EmailMessage for fallback values
 * @returns WorkOrderInput[] (without userId) or null if parsing fails
 */
function parseAiResponse(
  responseText: string,
  email: EmailMessage
): Omit<WorkOrderInput, "userId">[] | null {
  try {
    // Try to extract JSON from the response (in case it's wrapped in markdown code blocks)
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    }

    const parsed = JSON.parse(jsonText) as { workOrders: AiWorkOrder[] };

    if (!parsed.workOrders || !Array.isArray(parsed.workOrders)) {
      console.error("AI response missing workOrders array");
      return null;
    }

    if (parsed.workOrders.length === 0) {
      return [];
    }

    // Helper to sanitize amount strings (remove currency symbols, commas, etc.)
    const sanitizeAmountString = (amountStr: string | null | undefined): string | null => {
      if (!amountStr || typeof amountStr !== 'string') {
        return null;
      }
      // Remove all non-numeric characters except decimal point
      const sanitized = amountStr.replace(/[^0-9.]/g, '');
      if (!sanitized || sanitized === '.') {
        return null;
      }
      const num = parseFloat(sanitized);
      return isNaN(num) ? null : num.toFixed(2);
    };

    // Map AI response to WorkOrderInput[]
    return parsed.workOrders.map((wo) => {
      // Use nte_amount for amount if amount is empty but nte_amount is present
      // Sanitize both to ensure they're valid numeric strings
      const amount = sanitizeAmountString(wo.amount || wo.nte_amount);
      
      // Combine notes with any additional context
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
        amount: amount,
        currency: wo.currency || "USD",
        notes: notes || null,
        priority: wo.priority || null,
        calendarEventLink: null,
        workOrderPdfLink: null, // TODO: link to the PDF attachment if needed
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
 * 
 * This function:
 * 1. Checks if AI parsing is enabled
 * 2. Extracts text from all PDF attachments
 * 3. Calls OpenAI with a structured prompt
 * 4. Parses the JSON response into WorkOrderInput[] (without userId)
 * 
 * Note: userId must be attached separately after calling this function.
 * 
 * @param email - EmailMessage to parse
 * @returns WorkOrderInput[] (without userId) if successful, null if AI is disabled or encounters an error
 */
export async function aiParseWorkOrdersFromEmail(
  email: EmailMessage
): Promise<Omit<WorkOrderInput, "userId">[] | null> {
  // Check if AI parsing is enabled
  if (!isAiParsingEnabled()) {
    return null;
  }

  try {
    // Filter to PDF attachments only
    const pdfAttachments = email.attachments.filter((att) =>
      att.mimeType.toLowerCase().includes("pdf")
    );

    if (pdfAttachments.length === 0) {
      // No PDFs to parse
      return null;
    }

    // Extract text from all PDF attachments
    const pdfTexts: { filename: string; text: string }[] = [];
    
    // Limit PDF text to avoid hitting model context limits
    const MAX_CHARS_PER_PDF = 8000;
    
    for (const attachment of pdfAttachments) {
      try {
        const text = await getPdfTextFromAttachment(attachment);
        
        // Skip if we got an error placeholder text
        if (text.startsWith("UNAVAILABLE_PDF_CONTENT:")) {
          console.warn(
            `[AI Parser] Skipping PDF ${attachment.filename}: ${text}`
          );
          continue;
        }
        
        // Trim overly large strings to avoid hitting model context limits
        const trimmedText = text.slice(0, MAX_CHARS_PER_PDF);
        pdfTexts.push({ filename: attachment.filename, text: trimmedText });
      } catch (error) {
        console.error(
          `[AI Parser] Failed to extract text from PDF ${attachment.filename}:`,
          error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          } : error
        );
        // Continue with other PDFs even if one fails
      }
    }

    if (pdfTexts.length === 0) {
      console.error("No PDF text could be extracted");
      return null;
    }

    // Build the prompt
    const prompt = buildExtractionPrompt(email, pdfTexts);

    // Call OpenAI
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
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" }, // Request JSON mode if supported
      temperature: 0.1, // Low temperature for more deterministic extraction
    });
    
    const responseText = response.choices[0]?.message?.content;
    if (!responseText) {
      console.error("Empty response from OpenAI");
      return null;
    }
    
    return parseAiResponse(responseText, email);
  } catch (error) {
    // Log error but don't throw - we want to fall back to rule-based parsing
    console.error("AI parsing failed for email:", email.id, {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
      emailId: email.id,
      subject: email.subject,
      attachmentCount: email.attachments.length,
    });
    return null;
  }
}

/**
 * Export for debug/testing purposes.
 * Provides access to PDF text extraction for debugging endpoints.
 */
export async function getPdfTextFromAttachmentForDebug(
  attachment: EmailAttachment
): Promise<string> {
  return getPdfTextFromAttachment(attachment);
}


