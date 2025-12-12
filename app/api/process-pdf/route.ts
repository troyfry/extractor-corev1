/**
 * Direct PDF processing endpoint for manual uploads.
 * 
 * POST /api/process-pdf
 *   Body: FormData with 'file' field and optional 'emailText'
 *   Response: {
 *     workOrders: ParsedWorkOrder[],
 *     csv: string,
 *     meta: { fileCount, processedAt, aiModel? }
 *   }
 * 
 * NOTE: Manual upload is now a stateless converter (PDF -> WorkOrder[] -> CSV).
 * We intentionally do NOT persist work orders from this path.
 * 
 * This endpoint:
 * - Parses PDF(s) using AI or rule-based extraction
 * - Returns parsed work orders in memory
 * - Generates CSV for download
 * - Does NOT write to database
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { extractWorkOrderNumberFromText } from "@/lib/workOrders/processing";
import { extractTextFromPdfBuffer } from "@/lib/workOrders/aiParser";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { Plan } from "@/lib/plan";
import OpenAI from "openai";
import type { ParsedWorkOrder, ManualProcessResponse } from "@/lib/workOrders/parsedTypes";

// Ensure this route runs in Node.js runtime (not Edge) for PDF parsing
export const runtime = "nodejs";

// AI response structure
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
 * Escape a value for CSV format.
 * Handles quotes, commas, and newlines.
 */
function escapeCsvValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  
  const str = String(value);
  // Escape quotes by doubling them, then wrap in quotes
  // Also handle newlines and commas
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Generate CSV string from parsed work orders.
 */
function generateCsv(workOrders: ParsedWorkOrder[]): string {
  // Build CSV headers
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

  // Build CSV rows
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

  // Combine headers and rows
  const csvLines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.join(",")),
  ];

  return csvLines.join("\n");
}

/**
 * Parse AI response and convert to ParsedWorkOrder[].
 */
function parseAiResponse(
  responseText: string,
  filename: string
): ParsedWorkOrder[] | null {
  try {
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

    const now = new Date().toISOString();
    
    return parsed.workOrders.map((wo) => {
      // Sanitize amount to ensure it's a valid numeric string
      const amount = sanitizeAmountString(wo.amount || wo.nte_amount);
      const notes = [wo.notes, wo.nte_amount ? `NTE: ${wo.nte_amount}` : null]
        .filter(Boolean)
        .join(" | ");

      return {
        workOrderNumber: wo.work_order_number || `UNKNOWN-${Date.now()}`,
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
    return null;
  }
}

export async function POST(request: Request) {
  try {
    // Get userId from session if available (optional for free version)
    const session = await auth();
    const userId = session?.userId ?? null;

    const processedAt = new Date().toISOString();
    let aiModelUsed: string | undefined;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const emailText = formData.get("emailText") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Read file into buffer first (needed for validation)
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Validate file type - check MIME type, extension, and PDF magic bytes
    const isValidPdfType = file.type === "application/pdf" || 
                          file.type === "application/x-pdf" ||
                          file.name.toLowerCase().endsWith(".pdf");
    
    // Check PDF magic bytes (PDF files start with %PDF)
    // This ensures we validate by content, not just MIME type (important for serverless)
    const isValidPdfContent = buffer.length >= 4 && 
                             buffer[0] === 0x25 && // %
                             buffer[1] === 0x50 && // P
                             buffer[2] === 0x44 && // D
                             buffer[3] === 0x46;   // F
    
    if (!isValidPdfType && !isValidPdfContent) {
      return NextResponse.json(
        { error: "File must be a valid PDF. Please ensure the file is a PDF document." },
        { status: 400 }
      );
    }

    // If MIME type doesn't match but content does, log a warning but proceed
    if (!isValidPdfType && isValidPdfContent) {
      console.warn(`[PDF Validation] File "${file.name}" has incorrect MIME type "${file.type}" but valid PDF content`);
    }

    // Extract text from PDF directly from buffer (serverless-friendly - no filesystem needed)
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

    // Get current plan
    const plan = getPlanFromRequest(request);

    // Determine which OpenAI key to use based on plan
    let apiKey: string | null = null;
    
    if (plan === "FREE_BYOK") {
      // Free plan: Read BYOK from header (temporary - will move to client-side calls later)
      // IMPORTANT: This key is NEVER stored, logged, or persisted - only used for the request
      const byokKey = request.headers.get("x-openai-key");
      if (!byokKey || byokKey.trim().length === 0) {
        return NextResponse.json(
          { error: "OpenAI API key is required for Free (BYOK) plan. Please provide your key." },
          { status: 400 }
        );
      }
      apiKey = byokKey.trim();
      // NOTE: This BYOK key is never stored, logged, or written to database
    } else {
      // Pro/Premium plans: Use server-side OpenAI key only
      apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("Missing OPENAI_API_KEY environment variable");
        return NextResponse.json(
          { error: "Server configuration error: OpenAI API key not configured" },
          { status: 500 }
        );
      }
    }

    // Build candidate ParsedWorkOrder[] - try AI first, then fall back to rule-based
    // NOTE: Manual upload is stateless - we do NOT save to database
    let parsedWorkOrders: ParsedWorkOrder[] = [];

    // Try AI parser first (if enabled and key available)
    if (apiKey && isAiParsingEnabled()) {
      try {
        const profile = getIndustryProfile();
        const model = getAiModelName();
        
        // Build prompt with PDF and optional email text
        let prompt = `You are a Work Order Extraction Engine for ${profile.label}.

Extract work order information from the following PDF text${emailText ? " and email text" : ""} and return it as JSON.

IMPORTANT FIELD CLARIFICATIONS:
- "vendor_name": The FACILITY MANAGEMENT PLATFORM/COMPANY sending the work order (e.g., ServiceChannel, Corrigo, FMX, Hippo, ServiceTrade, Brightly). This is NOT the service provider/contractor doing the work (NOT the cleaning company, HVAC company, plumber, etc.).
- "customer_name": The job site/client/facility where the work is being performed.
- "service_address": The physical address where the work will be done.

PDF Filename: ${file.name}

PDF Content:
${pdfText.slice(0, 8000)}`;

        if (emailText && emailText.trim()) {
          prompt += `\n\nEmail Text:\n${emailText.trim().slice(0, 2000)}`;
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

IMPORTANT: Return ONLY the JSON object, no markdown, no code blocks, no explanations.`;

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
      // Email text format might be: "Subject: ...\n\nBody: ..." or just plain text
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
        jobDescription: emailBody ? emailBody.trim().slice(0, 500) : null, // Use email body as description
        amount: null,
        currency: "USD",
        notes: emailText ? (emailSubject ? `Subject: ${emailSubject}\n\n${emailBody}` : emailBody).trim() : null, // Store full email text in notes
        priority: null,
      }];
    }

    // Generate CSV from parsed work orders
    const csv = generateCsv(parsedWorkOrders);

    // Return parsed work orders and CSV (no database writes)
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
    console.error("Error in POST /api/process-pdf", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process PDF";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

