/**
 * Extract full work order details from PDF buffer using digital text + AI.
 * This runs once when the PDF is first uploaded to Drive.
 * 
 * FIELD AUTHORITY POLICY:
 * - Work Order Number: Uses cropped region only (when available) - see extractWorkOrderNumber.ts
 * - Detail Fields (address, job type, notes, amount): Uses FULL PDF TEXT
 *   This is intentional - detail fields are "content fields" that may appear anywhere
 *   in the document, so we extract from the entire PDF for maximum coverage.
 */

import { extractTextFromPdfBuffer } from "./aiParser";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import { OpenAI } from "openai";
import type { ParsedWorkOrder } from "./parsedTypes";

export interface ExtractFromPdfParams {
  pdfBuffer: Buffer;
  pdfFilename?: string;
  aiEnabled?: boolean;
  openaiKey?: string | null;
  fmKey?: string | null;
  workOrderNumber?: string | null; // If already known from subject/filename
  emailSubject?: string; // For context
}

/**
 * Extract full work order details from PDF buffer.
 * Uses digital text extraction (accurate) + AI parsing.
 */
export async function extractWorkOrderDetailsFromPdf(
  params: ExtractFromPdfParams
): Promise<Partial<ParsedWorkOrder>> {
  const {
    pdfBuffer,
    pdfFilename,
    aiEnabled,
    openaiKey,
    fmKey,
    workOrderNumber,
    emailSubject,
  } = params;

  // Extract PDF text using digital extraction (fast, accurate)
  let pdfText = "";
  try {
    pdfText = await extractTextFromPdfBuffer(pdfBuffer);
    console.log(`[Extract From PDF] Extracted ${pdfText.length} characters from digital text`);
  } catch (error) {
    console.warn("[Extract From PDF] Digital text extraction failed (scanned PDF?):", error);
    // Return empty - will use fallback values
    return {};
  }

  if (!pdfText || pdfText.trim().length === 0) {
    console.warn("[Extract From PDF] No text extracted from PDF");
    return {};
  }

  // Use AI to extract full details from digital text
  if (aiEnabled && openaiKey && isAiParsingEnabled(aiEnabled, openaiKey)) {
    try {
      const profile = getIndustryProfile();
      const model = getAiModelName();

      const prompt = `You are a Work Order Extraction Engine for ${profile.label}.

Extract ALL available work order information from the following work order PDF text. This is the ORIGINAL work order, so all text is digital and accurate.

${emailSubject ? `Email Subject: ${emailSubject}\n\n` : ""}
${pdfFilename ? `PDF Filename: ${pdfFilename}\n\n` : ""}
${workOrderNumber ? `NOTE: The work order number is already known: ${workOrderNumber}\n\n` : ""}

IMPORTANT FIELD CLARIFICATIONS:
- "customer_name": The job site/client/facility name where the work is being performed (e.g., "Petco # 2811", "Walmart Store #1234", "Job Site Name")
- "service_address": The full physical address where the work will be done (street, city, state, zip)
- "job_type": The type of service/work (e.g., "Floor Scrub and Buff", "HVAC Repair", "Plumbing", "Janitorial")
- "nte_amount": "Not To Exceed" amount if present (extract numeric only, no $ or commas)
- "amount": Dollar amounts, totals, invoice amounts, service fees (extract numeric only, no $ or commas)
- "job_description": Detailed description of the work to be performed
- "vendor_name": Facility management platform (ServiceChannel, Corrigo, FMX, etc.) - NOT the service provider

PDF Text (Digital - Accurate):
${pdfText.slice(0, 8000)}

Return a JSON object with this exact structure:
{
  "work_order_number": "${workOrderNumber || ""}",
  "customer_name": "",
  "service_address": "",
  "job_type": "",
  "job_description": "",
  "amount": "",
  "nte_amount": "",
  "currency": "USD",
  "scheduled_date": "",
  "priority": "",
  "notes": "",
  "vendor_name": ""
}

IMPORTANT: 
- Return ONLY the JSON object, no markdown, no code blocks, no explanations.
- Extract numeric values for amounts (remove $, commas, spaces).
- If NTE amount is present, include it in nte_amount field.
- Be thorough - check all sections of the document for each field.`;

      const client = new OpenAI({ apiKey: openaiKey });
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
      if (responseText) {
        try {
          const parsed = JSON.parse(responseText);
          
          // Sanitize amount strings
          const sanitizeAmount = (amountStr: string | null | undefined): string | null => {
            if (!amountStr || typeof amountStr !== "string") return null;
            const sanitized = amountStr.replace(/[^0-9.]/g, "");
            if (!sanitized || sanitized === ".") return null;
            const num = parseFloat(sanitized);
            return Number.isNaN(num) ? null : num.toFixed(2);
          };

          const extracted: Partial<ParsedWorkOrder> = {
            workOrderNumber: parsed.work_order_number || workOrderNumber || null,
            customerName: parsed.customer_name || null,
            serviceAddress: parsed.service_address || null,
            jobType: parsed.job_type || null,
            jobDescription: parsed.job_description || null,
            amount: sanitizeAmount(parsed.amount || parsed.nte_amount),
            currency: parsed.currency || "USD",
            notes: parsed.notes || (parsed.nte_amount ? `NTE: ${parsed.nte_amount}` : null),
            priority: parsed.priority || null,
            vendorName: parsed.vendor_name || null,
            scheduledDate: parsed.scheduled_date || null,
          };

          console.log("[Extract From PDF] Successfully extracted work order details:", {
            customerName: extracted.customerName,
            serviceAddress: extracted.serviceAddress,
            jobType: extracted.jobType,
            amount: extracted.amount,
          });

          return extracted;
        } catch (parseError) {
          console.error("[Extract From PDF] Failed to parse AI response:", parseError);
        }
      }
    } catch (error) {
      console.error("[Extract From PDF] AI extraction failed:", error);
    }
  }

  // Return empty if AI not enabled or failed
  return {};
}
