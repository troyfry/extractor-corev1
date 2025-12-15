/**
 * Pro tier PDF extraction endpoint.
 * 
 * POST /api/extract-pro
 *   Body: FormData with 'file' field and optional 'emailText'
 *   Response: { workOrders: WorkOrder[] }
 * 
 * This endpoint:
 * - Requires authentication (NextAuth session)
 * - Parses PDF(s) using AI or rule-based extraction
 * - Uses server-side OpenAI API key
 * - Saves work orders to database with userId from session
 * - Returns saved WorkOrder[] (with id, createdAt, etc.)
 * 
 * TODO Phase 2: Gmail inbox mode will plug in here.
 * TODO Phase 2: Template Profiles will eventually plug in.
 * TODO Phase 2: Vision fallback will be added.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { extractWorkOrderNumberFromText } from "@/lib/workOrders/processing";
import { extractTextFromPdfBuffer } from "@/lib/workOrders/aiParser";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import { workOrderRepo } from "@/lib/workOrders/repository";
import type { WorkOrder, WorkOrderInput } from "@/lib/workOrders/types";
import type { ParsedWorkOrder } from "@/lib/workOrders/parsedTypes";
import OpenAI from "openai";

// Ensure this route runs in Node.js runtime (not Edge) for PDF parsing
export const runtime = "nodejs";

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
 * Convert ParsedWorkOrder[] to WorkOrderInput[] for database insertion.
 */
function parsedToWorkOrderInput(parsed: ParsedWorkOrder[], userId: string): WorkOrderInput[] {
  return parsed.map((p) => ({
    userId, // Pro tier: use authenticated user ID
    workOrderNumber: p.workOrderNumber,
    timestampExtracted: p.timestampExtracted,
    scheduledDate: p.scheduledDate,
    serviceAddress: p.serviceAddress,
    jobType: p.jobType,
    customerName: p.customerName,
    vendorName: p.vendorName,
    jobDescription: p.jobDescription,
    amount: p.amount,
    currency: p.currency,
    notes: p.notes,
    priority: p.priority,
    calendarEventLink: null,
    workOrderPdfLink: null,
  }));
}

export async function POST(request: Request) {
  try {
    // Require authentication for Pro tier
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = user.userId;
    const processedAt = new Date().toISOString();
    let aiModelUsed: string | undefined;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const formData = await request.formData();
    const file = formData.get("file");

    // Improved file validation - check if it's actually a File instance
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
    }

    const emailText = formData.get("emailText") as string | null;

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

    // Pro tier: Use server-side OpenAI key
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

    // Write directly to Google Sheets + Drive (no DB persistence)
    // Sheets + Drive is the system of record
    const accessToken = user?.googleAccessToken || null;
    
    if (accessToken) {
      try {
        const { getUserSpreadsheetId } = await import("@/lib/userSettings/repository");
        const { auth } = await import("@/auth");
        const { cookies } = await import("next/headers");
        
        // Check cookie first (session-based, no DB)
        const cookieSpreadsheetId = (await cookies()).get("googleSheetsSpreadsheetId")?.value || null;
        
        // Use cookie if available, otherwise check session/JWT token, then DB
        let spreadsheetId: string | null = null;
        if (cookieSpreadsheetId) {
          spreadsheetId = cookieSpreadsheetId;
        } else {
          // Then check session/JWT token
          const session = await auth();
          const sessionSpreadsheetId = session ? (session as any).googleSheetsSpreadsheetId : null;
          spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
        }
        
        if (spreadsheetId) {
          console.log("[extract-pro] Writing work orders to Sheets + Drive:", {
            spreadsheetId: `${spreadsheetId.substring(0, 10)}...`,
            workOrdersCount: parsedWorkOrders.length,
          });

          // Use the PDF buffer that was already read for validation
          const pdfBuffer = buffer;
          const pdfFilename = file.name;

          // Extract issuerKey from user email domain (for manual uploads)
          // Parse domain from user email (e.g., "user@example.com" -> "example.com")
          function extractIssuerKeyFromEmail(email: string | null | undefined): string {
            if (!email) return "manual";
            const emailMatch = email.match(/@([^\s>]+)/);
            if (emailMatch && emailMatch[1]) {
              const domain = emailMatch[1].toLowerCase().trim();
              const parts = domain.split(".");
              if (parts.length >= 2) {
                return parts.slice(-2).join("."); // e.g., "example.com" from "mail.example.com"
              }
              return domain;
            }
            return "manual";
          }

          // Derive issuerKey from user email (or use "manual" as fallback)
          const issuerKey = extractIssuerKeyFromEmail(user.email || null);
          console.log(`[extract-pro] Using issuerKey: ${issuerKey}`);

          // Write to Sheets with PDF upload to Drive
          const { writeWorkOrdersToSheets } = await import("@/lib/workOrders/sheetsIngestion");
          await writeWorkOrdersToSheets(
            parsedWorkOrders,
            accessToken,
            spreadsheetId,
            issuerKey,
            pdfBuffer ? [pdfBuffer] : undefined,
            pdfFilename ? [pdfFilename] : undefined
          );
          
          console.log("[extract-pro] Successfully wrote work orders to Sheets + Drive");
        } else {
          console.log("[extract-pro] No spreadsheet ID configured, skipping Sheets/Drive write");
        }
      } catch (sheetsError) {
        // Log but don't fail the request
        console.error("[extract-pro] Error writing to Sheets/Drive:", sheetsError);
        if (sheetsError instanceof Error) {
          console.error("[extract-pro] Error details:", {
            message: sheetsError.message,
            stack: sheetsError.stack,
          });
        }
      }
    } else {
      console.log("[extract-pro] No access token available, skipping Sheets/Drive write");
    }

    // Return parsed work orders (no DB persistence - Sheets + Drive is the system of record)
    return NextResponse.json(
      { workOrders: parsedWorkOrders },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in POST /api/extract-pro", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process PDF";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

