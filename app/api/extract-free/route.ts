/**
 * Free tier PDF extraction endpoint.
 * 
 * POST /api/extract-free
 *   Body: FormData with 'file' field and optional 'emailText'
 *   Response: { workOrders: ParsedWorkOrder[], csv: string, meta: {...} }
 * 
 * This endpoint:
 * - No authentication required (public)
 * - Uses server-side OpenAI key with rate limiting
 * - Rate limited (per-IP daily/monthly + global monthly cap)
 * - Parses PDF(s) using AI or rule-based extraction
 * - Returns parsed work orders in memory (NO database writes)
 * - Generates CSV for download
 * - Stateless converter: PDF → WorkOrder[] → CSV
 * 
 * IMPORTANT: Free tier is stateless - no database writes, no history, no persistence.
 * Hard limits protect server-side OpenAI token spend.
 * 
 * TODO Phase 2: Gmail inbox mode will plug in here.
 * TODO Phase 2: Template Profiles will eventually plug in.
 * TODO Phase 2: Vision fallback will be added.
 */
import { NextResponse } from "next/server";
import { extractWorkOrderNumberFromText } from "@/lib/workOrders/processing";
import { extractTextFromPdfBuffer } from "@/lib/workOrders/aiParser";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import { checkFreeLimits, incrementFreeUsage } from "@/lib/limits/checkFreeLimits";
import type { ParsedWorkOrder, ManualProcessResponse } from "@/lib/workOrders/parsedTypes";
import OpenAI from "openai";

// Ensure this route runs in Node.js runtime (not Edge) for PDF parsing
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { ok: false, message: "Use POST with multipart/form-data (field name: file)" },
    { status: 405 }
  );
}

// AI response structure
type AiWorkOrder = {
  work_order_number: string;
  customer_name: string | null;
  vendor_name: string | null;
  service_address: string | null;
  job_type: string | null;
  job_description: string | null;
  scheduled_date: string | null;
  priority: string | null;
  amount: string | null;
  currency: string | null;
  nte_amount: string | null;
  service_category: string | null;
  facility_id: string | null;
  notes: string | null;
};

type AiParserResponse = {
  workOrders: AiWorkOrder[];
};

/**
 * Parse AI response and convert to ParsedWorkOrder[].
 */
function parseAiResponse(
  responseText: string,
  filename: string
): ParsedWorkOrder[] | null {
  try {
    // Try to extract JSON from the response (in case it's wrapped in markdown code blocks)
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    }

    const parsed = JSON.parse(jsonText) as AiParserResponse;

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

    // Map AI response to ParsedWorkOrder[]
    const now = new Date().toISOString();
    return parsed.workOrders.map((wo) => {
      // Use nte_amount for amount if amount is empty but nte_amount is present
      const amount = sanitizeAmountString(wo.amount || wo.nte_amount);
      
      // Combine notes with any additional context
      const notes = [wo.notes, wo.nte_amount ? `NTE: ${wo.nte_amount}` : null]
        .filter(Boolean)
        .join(" | ");

      return {
        workOrderNumber: wo.work_order_number || `UNKNOWN-${filename.slice(0, 8)}`,
        timestampExtracted: now,
        scheduledDate: wo.scheduled_date || now,
        serviceAddress: wo.service_address || null,
        jobType: wo.job_type || null,
        customerName: wo.customer_name || null,
        vendorName: wo.vendor_name || null,
        jobDescription: wo.job_description || null,
        amount: amount,
        currency: wo.currency || "USD",
        notes: notes || null,
        priority: wo.priority || null,
      };
    });
  } catch (error) {
    console.error("Failed to parse AI response as JSON:", error);
    console.error("Response text:", responseText);
    return null;
  }
}

/**
 * Generate CSV from parsed work orders.
 */
function generateCsv(workOrders: ParsedWorkOrder[]): string {
  const escapeCsvValue = (value: string | null | undefined): string => {
    if (value === null || value === undefined) {
      return "";
    }
    const str = String(value);
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    "Work Order Number",
    "Scheduled Date",
    "Customer Name",
    "Service Address",
    "Job Type",
    "Job Description",
    "Amount",
    "Currency",
    "Priority",
    "Notes",
    "Vendor Name",
    "Timestamp Extracted",
  ];

  const rows = workOrders.map((wo) => [
    escapeCsvValue(wo.workOrderNumber),
    escapeCsvValue(wo.scheduledDate),
    escapeCsvValue(wo.customerName),
    escapeCsvValue(wo.serviceAddress),
    escapeCsvValue(wo.jobType),
    escapeCsvValue(wo.jobDescription),
    escapeCsvValue(wo.amount),
    escapeCsvValue(wo.currency),
    escapeCsvValue(wo.priority),
    escapeCsvValue(wo.notes),
    escapeCsvValue(wo.vendorName),
    escapeCsvValue(wo.timestampExtracted),
  ]);

  const csvLines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.join(",")),
  ];

  return csvLines.join("\n");
}

export async function POST(request: Request) {
  try {
    // Check rate limits first (before processing)
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : undefined;
    const limitCheck = await checkFreeLimits({ ip });
    
    if (!limitCheck.allowed) {
      const reasonMessages = {
        daily: "You've reached the daily limit (10 documents per day). Create a Pro account to continue.",
        monthly: "You've reached the monthly limit (20 documents per month). Create a Pro account to continue.",
        global: "Free tier is temporarily paused due to high demand. Please try again next month or create a Pro account.",
      };
      
      return NextResponse.json(
        { 
          error: "Free limit reached",
          reason: limitCheck.reason,
          message: reasonMessages[limitCheck.reason || "daily"],
        },
        { status: 429 }
      );
    }

    const processedAt = new Date().toISOString();
    let aiModelUsed: string | undefined;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const formData = await request.formData();
    const file = formData.get("file");
    const emailText = formData.get("emailText") as string | null;

    // Improved file validation - check if it's actually a File instance
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
    }

    // Read file into buffer first (needed for validation)
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Temporary production debug logging - remove after verification
    console.log("PDF buffer size:", buffer.length);
    console.log("PDF header:", buffer.subarray(0, 8).toString("utf8"));
    console.log("File name:", file.name);
    console.log("File type:", file.type);
    console.log("File size:", file.size);

    // Quick validity check using header (helps debug prod)
    const header = buffer.subarray(0, 5).toString("utf8");
    if (header !== "%PDF-") {
      console.error("Invalid PDF header detected:", header);
      return NextResponse.json(
        { error: "Upload did not arrive as a valid PDF." },
        { status: 400 }
      );
    }

    // Validate file type - check MIME type and extension (header check already passed)
    const isValidPdfType = file.type === "application/pdf" || 
                          file.type === "application/x-pdf" ||
                          file.name.toLowerCase().endsWith(".pdf");
    
    // If MIME type doesn't match but header does, log a warning but proceed
    if (!isValidPdfType) {
      console.warn(`[PDF Validation] File "${file.name}" has incorrect MIME type "${file.type}" but valid PDF header`);
    }

    // Extract text from PDF directly from buffer
    let pdfText: string;
    try {
      pdfText = await extractTextFromPdfBuffer(buffer);
    } catch (error) {
      console.error("Error extracting text from PDF:", error);
      return NextResponse.json(
        { error: "Failed to extract text from PDF. Please ensure the file is a valid PDF." },
        { status: 400 }
      );
    }
    
    if (!pdfText || pdfText.trim().length === 0) {
      return NextResponse.json(
        { error: "PDF appears to be empty or contains no extractable text" },
        { status: 400 }
      );
    }

    // Free tier: Use server-side OpenAI key with rate limiting
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY environment variable");
      return NextResponse.json(
        { error: "Server configuration error: OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Build candidate ParsedWorkOrder[] - try AI first, then fall back to rule-based
    let parsedWorkOrders: ParsedWorkOrder[] = [];

    // Try AI parser first (if enabled and key available)
    if (apiKey && isAiParsingEnabled()) {
      try {
        const profile = getIndustryProfile();
        const model = getAiModelName();
        
        // Build prompt with PDF and optional email text
        let prompt = `You are a highly accurate Work Order Extraction Engine for ${profile.label}.

Your task is to extract ALL available fields from the work order document. You must be thorough and consistent - check every section of the document for each field.

EXTRACTION RULES (follow strictly):

1. COMPLETENESS: Extract EVERY field that appears in the document. Do not skip fields that are present.

2. FIELD LOCATIONS - Check these areas for each field:
   - "work_order_number": Look in headers, top of document, subject line, work order # field
   - "customer_name": Look for facility name, location name, client name, store name (e.g., "Petco # 2811")
   - "vendor_name": Facility management platform (ServiceChannel, Corrigo, FMX, etc.) - NOT the service provider
   - "service_address": Full address including street, city, state, zip
   - "job_type": Service type, work type, category (e.g., "Floor Scrub and Buff")
   - "job_description": Detailed description of the work to be performed
   - "scheduled_date": Service date, scheduled date, appointment date (convert to ISO format YYYY-MM-DD)
   - "priority": Priority level if mentioned
   - "amount": Look for dollar amounts, totals, invoice amounts, service fees (extract numeric only, no $ or commas)
   - "nte_amount": "Not To Exceed" amount if present
   - "notes": ALL additional information, instructions, special notes, service frequency, check-in requirements, etc.
   - "service_category": Category or classification if present
   - "facility_id": Facility ID, location ID, store number if present

3. AMOUNT EXTRACTION:
   - Search the ENTIRE document for any dollar amounts
   - Look in: totals, fees, charges, NTE fields, invoice amounts, service costs
   - Extract ONLY numeric characters (remove $, commas, spaces)
   - If you find "$5,678.00" extract "5678.00"
   - If amount is missing but NTE is present, use NTE value for amount

4. NOTES EXTRACTION:
   - Extract ALL text that provides additional context, instructions, or requirements
   - Include: service frequency ("1x Mon", "Weekly", "Monthly")
   - Include: special instructions ("Crews must check in/out using Superclean IVR")
   - Include: any text that doesn't fit in other fields
   - Combine multiple note sections with " | " separator

5. CONSISTENCY:
   - Use the SAME extraction logic for ALL work orders in the same document
   - If one work order has notes, check if others do too
   - If one work order has an amount, check if others do too
   - Be thorough - don't assume a field is missing just because it's in a different location

6. MISSING FIELDS:
   - Only return empty string "" if you have thoroughly searched and the field is truly not present
   - Double-check before marking a field as empty

PDF Filename: ${file.name}

PDF Content:
${pdfText.slice(0, 8000)}`;

        if (emailText && emailText.trim()) {
          prompt += `\n\nEmail Text (additional context):
${emailText.trim().slice(0, 2000)}`;
        }
        
        prompt += `

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

CRITICAL: 
- Extract ALL fields that are present in the document
- Be consistent across all work orders
- Check the ENTIRE document for amounts and notes
- Return ONLY the JSON object, no markdown, no code blocks, no explanations.`;

        const client = new OpenAI({ apiKey });
        const response = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: "You are a highly accurate Work Order Extraction Engine. Always respond with valid JSON only, no explanations.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        });
        
        // Capture token usage
        if (response.usage) {
          totalPromptTokens += response.usage.prompt_tokens || 0;
          totalCompletionTokens += response.usage.completion_tokens || 0;
          totalTokens += response.usage.total_tokens || 0;
        }
        
        const responseText = response.choices[0]?.message?.content;
        if (responseText) {
          const aiResult = parseAiResponse(responseText, file.name);
          if (aiResult && aiResult.length > 0) {
            parsedWorkOrders = aiResult;
            aiModelUsed = model;
            console.log(`AI parser produced ${aiResult.length} work order(s) from PDF`);
          }
        }
      } catch (aiError) {
        console.error("AI parsing failed, falling back to rule-based:", aiError);
      }
    }

    // Fall back to rule-based parser if AI didn't produce results
    if (parsedWorkOrders.length === 0) {
      // Try to extract work order number from email text first (if provided), then from filename
      let workOrderNumber: string | null = null;
      if (emailText) {
        workOrderNumber = extractWorkOrderNumberFromText(emailText);
      }
      if (!workOrderNumber) {
        workOrderNumber = extractWorkOrderNumberFromText(file.name);
      }
      
      // If still no work order number found, we can't proceed without one
      if (!workOrderNumber) {
        return NextResponse.json(
          { 
            error: "Could not extract work order number from PDF filename or email text. Please ensure the work order number is present in the filename (e.g., '1898060.pdf') or in the email text (e.g., 'WO# 1898060')." 
          },
          { status: 400 }
        );
      }
      
      const now = new Date().toISOString();
      
      // Parse email text to extract subject and body if provided
      let emailSubject = "";
      let emailBody = emailText || "";
      
      if (emailText) {
        const subjectMatch = emailText.match(/Subject:\s*(.+?)(?:\n|$)/i);
        if (subjectMatch) {
          emailSubject = subjectMatch[1].trim();
          emailBody = emailText.replace(/Subject:\s*.+?(?:\n|$)/i, "").trim();
        }
      }
      
      parsedWorkOrders = [{
        workOrderNumber,
        timestampExtracted: now,
        scheduledDate: now,
        serviceAddress: null,
        jobType: null,
        customerName: null,
        vendorName: null,
        jobDescription: emailBody ? emailBody.trim().slice(0, 500) : null,
        amount: null,
        currency: "USD",
        notes: emailText ? (emailSubject ? `Subject: ${emailSubject}\n\n${emailBody}` : emailBody).trim() : null,
        priority: null,
      }];
    }

    // Generate CSV from parsed work orders
    const csv = generateCsv(parsedWorkOrders);

    // Increment usage counters AFTER successful processing
    // This ensures failed requests don't count against limits
    // Wrap in try-catch so counting errors don't break the request
    console.log(`[extract-free] Attempting to increment usage for IP: ${ip}`);
    try {
      await incrementFreeUsage({ ip });
      console.log(`[extract-free] Successfully incremented usage counters`);
    } catch (countError) {
      console.error("[extract-free] Error incrementing free usage counter:", countError);
      console.error("[extract-free] Error details:", {
        message: countError instanceof Error ? countError.message : String(countError),
        stack: countError instanceof Error ? countError.stack : undefined,
      });
      // Don't fail the request if counting fails - log and continue
      // But log the full error so we can debug why counting isn't working
    }

    // Return parsed work orders and CSV (NO database writes for work orders - stateless)
    // But we DO write to rate limiting tables to track usage
    const response: ManualProcessResponse = {
      workOrders: parsedWorkOrders,
      csv,
      meta: {
        fileCount: 1,
        processedAt,
        source: "manual",
        ...(aiModelUsed ? { aiModel: aiModelUsed } : {}),
        ...(totalTokens > 0 ? {
          tokenUsage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalTokens,
          },
        } : {}),
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error in POST /api/extract-free", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process PDF";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

