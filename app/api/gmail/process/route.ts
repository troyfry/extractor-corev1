/**
 * API route to process a Gmail email and extract work orders from PDF attachments.
 * 
 * POST /api/gmail/process
 * Body: { messageId: string }
 * Response: ManualProcessResponse (same as /api/process-pdf)
 * 
 * Stateless - does not write to database.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getEmailWithPdfAttachments } from "@/lib/google/gmail";
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { transitionToProcessed, transitionToNeedsReview } from "@/lib/google/gmailLabels";
import { extractWorkOrderNumberFromText } from "@/lib/workOrders/processing";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import { getPlanFromRequest } from "@/lib/_deprecated/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
// import { Plan } from "@/lib/plan"; // Unused for now
import { extractTextFromPdfBuffer as extractTextFromPdfBufferAiParser } from "@/lib/workOrders/aiParser";
import OpenAI from "openai";
import type { ParsedWorkOrder, ManualProcessResponse } from "@/lib/workOrders/parsedTypes";
import type { WorkOrderRecord } from "@/lib/google/sheets";

/**
 * Request body type for Gmail process endpoint.
 */
type GmailProcessRequest = {
  messageId: string;
  autoRemoveLabel?: boolean;
};

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

type _AiParserResponse = {
  workOrders: AiWorkOrder[];
};

/**
 * Extract text from a PDF Buffer.
 * Uses the same extraction method as the manual upload (from aiParser.ts).
 * Uses pdf-parse for stable PDF text extraction.
 */
async function extractTextFromPdfBuffer(buffer: Buffer, filename: string): Promise<string> {
  try {
    console.log(`[Gmail Process] Extracting text from PDF buffer (size: ${buffer.length} bytes, filename: ${filename})`);
    
    // Use the same extraction function as manual upload (from aiParser.ts)
    // Uses pdf-parse for stable PDF text extraction
    const text = await extractTextFromPdfBufferAiParser(buffer);
    console.log(`[Gmail Process] PDF text extraction: ${text.length} characters extracted`);
    
    if (text.length === 0) {
      console.warn(`[Gmail Process] PDF text extraction returned empty string. PDF may be image-based or corrupted.`);
    }
    
    return text;
  } catch (error) {
    console.error(`[Gmail Process] Failed to extract text from PDF buffer:`, error instanceof Error ? error.message : error);
    return "";
  }
}

/**
 * Escape a value for CSV format.
 */
function escapeCsvValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV string from parsed work orders.
 */
async function generateCsv(workOrders: ParsedWorkOrder[], issuerKey: string): Promise<string> {
  const { generateJobId } = await import("@/lib/workOrders/sheetsIngestion");
  
  const headers = [
    "Job ID",
    "Issuer",
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

  const rows = workOrders.map((wo) => {
    const jobId = generateJobId(issuerKey, wo.workOrderNumber);
    return [
      escapeCsvValue(jobId),
      escapeCsvValue(issuerKey), // Use issuerKey from email sender domain (stable)
      escapeCsvValue(wo.workOrderNumber || ""),
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
    ];
  });

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
  _filename: string
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

    // Helper to sanitize amount strings
    const sanitizeAmountString = (amountStr: string | null | undefined): string | null => {
      if (!amountStr || typeof amountStr !== 'string') {
        return null;
      }
      const sanitized = amountStr.replace(/[^0-9.]/g, '');
      if (!sanitized || sanitized === '.') {
        return null;
      }
      const num = parseFloat(sanitized);
      return isNaN(num) ? null : num.toFixed(2);
    };

    const now = new Date().toISOString();
    
    return parsed.workOrders.map((wo) => {
      const amount = sanitizeAmountString(wo.amount || wo.nte_amount);
      const notes = [wo.notes, wo.nte_amount ? `NTE: ${wo.nte_amount}` : null]
        .filter(Boolean)
        .join(" | ");

      return {
        workOrderNumber: wo.work_order_number || null, // null if missing - routes to "Verification"
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
        fmKey: null, // Will be matched later
      };
    });
  } catch (error) {
    console.error("Failed to parse AI response as JSON:", error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Check plan and feature access
    const plan = getPlanFromRequest(request);
    
    // Gmail import is a Pro/Premium feature only
    // Free plan users should NOT use this endpoint
    if (plan === "FREE_BYOK") {
      return NextResponse.json(
        { error: "Gmail import is not available on Free plan. Please upgrade to Pro or Premium." },
        { status: 403 }
      );
    }

    // Ensure Pro/Premium have Gmail feature access
    if (!hasFeature(plan, "canUseGmailImport")) {
      return NextResponse.json(
        { error: "Gmail import is not available on your current plan. Please upgrade to Pro or Premium." },
        { status: 403 }
      );
    }

    const accessToken = user.googleAccessToken;
    
    if (!accessToken) {
      return NextResponse.json(
        { 
          error: "No Google access token available. Please sign out and sign in again to grant Gmail access.",
        },
        { status: 400 }
      );
    }

    const body = await request.json() as GmailProcessRequest;
    const { messageId, autoRemoveLabel = false } = body;

    if (!messageId || typeof messageId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid messageId" },
        { status: 400 }
      );
    }

    // Fetch email with PDF attachments
    console.log(`[Gmail Process] Fetching email ${messageId} with PDF attachments...`);
    const email = await getEmailWithPdfAttachments(accessToken, messageId);
    console.log(`[Gmail Process] Email fetched. Subject: "${email.subject}", PDF attachments: ${email.pdfAttachments.length}`);

    if (email.pdfAttachments.length === 0) {
      console.warn(`[Gmail Process] No PDF attachments found in email ${messageId}. Subject: "${email.subject}"`);
      return NextResponse.json(
        { error: "No PDF attachments found in this email" },
        { status: 400 }
      );
    }

    const processedAt = new Date().toISOString();
    let aiModelUsed: string | undefined;
    const allParsedWorkOrders: ParsedWorkOrder[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    // If multiple PDFs, identify which one is the work order
    let pdfsToProcess = email.pdfAttachments;
    if (email.pdfAttachments.length > 1) {
      console.log(`[Gmail Process] Multiple PDFs detected (${email.pdfAttachments.length}). Identifying work order PDF...`);
      
      /**
       * Score PDFs to identify which is most likely the work order.
       * Higher score = more likely to be the work order.
       */
      const scorePdf = (pdf: typeof email.pdfAttachments[0]): number => {
        let score = 0;
        const filename = pdf.filename.toLowerCase();
        
        // Filename patterns that indicate work orders
        const workOrderPatterns = [
          /work\s*order/i,
          /wo\s*#?/i,
          /service\s*order/i,
          /job\s*order/i,
          /task\s*order/i,
          /request\s*#?/i,
        ];
        
        // Filename patterns that indicate NOT work orders (invoices, receipts, etc.)
        const nonWorkOrderPatterns = [
          /invoice/i,
          /receipt/i,
          /payment/i,
          /statement/i,
          /bill/i,
          /quote/i,
          /estimate/i,
          /proposal/i,
        ];
        
        // Check for work order patterns in filename
        for (const pattern of workOrderPatterns) {
          if (pattern.test(filename)) {
            score += 10;
            break;
          }
        }
        
        // Penalize non-work-order patterns
        for (const pattern of nonWorkOrderPatterns) {
          if (pattern.test(filename)) {
            score -= 5;
            break;
          }
        }
        
        // Prefer larger files (work orders are usually more detailed)
        const sizeMB = pdf.data.length / (1024 * 1024);
        if (sizeMB > 0.5) {
          score += 3; // Larger files more likely to be work orders
        } else if (sizeMB < 0.1) {
          score -= 2; // Very small files might be receipts/invoices
        }
        
        // Prefer files with work order numbers in filename (6-10 digits)
        if (/\b\d{6,10}\b/.test(filename)) {
          score += 5;
        }
        
        return score;
      };
      
      // Score all PDFs
      const scoredPdfs = email.pdfAttachments.map((pdf) => ({
        pdf,
        score: scorePdf(pdf),
      }));
      
      // Sort by score (highest first)
      scoredPdfs.sort((a, b) => b.score - a.score);
      
      console.log(`[Gmail Process] PDF scores:`, scoredPdfs.map((s) => ({
        filename: s.pdf.filename,
        score: s.score,
        size: `${(s.pdf.data.length / 1024).toFixed(1)} KB`,
      })));
      
      // Use the highest-scoring PDF (work order)
      const bestPdf = scoredPdfs[0];
      pdfsToProcess = [bestPdf.pdf];
      
      console.log(`[Gmail Process] Selected work order PDF: "${bestPdf.pdf.filename}" (score: ${bestPdf.score}). Ignoring ${email.pdfAttachments.length - 1} other PDF(s).`);
    }
    
    // Read AI configuration from headers (optional) - outside loop so it's available for extraction
    const aiEnabled = request.headers.get("x-ai-enabled") === "true";
    const apiKey = request.headers.get("x-openai-key")?.trim() || null;

    // Process the selected PDF(s)
    console.log(`[Gmail Process] Processing ${pdfsToProcess.length} PDF attachment(s) for message ${messageId}`);
    for (const pdfAttachment of pdfsToProcess) {
      // Extract text from PDF buffer (using same method as manual upload)
      const pdfText = await extractTextFromPdfBuffer(pdfAttachment.data, pdfAttachment.filename);
      
      if (!pdfText || pdfText.trim().length === 0) {
        console.warn(`[Gmail Process] Failed to extract text from PDF: ${pdfAttachment.filename}`);
        continue;
      }
      
      console.log(`[Gmail Process] Extracted ${pdfText.length} characters from PDF: ${pdfAttachment.filename}`);

      // Build email text context from email metadata
      const emailText = [
        `Subject: ${email.subject}`,
        `From: ${email.from}`,
        `Date: ${email.date}`,
        email.snippet ? `Snippet: ${email.snippet}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      let parsedWorkOrders: ParsedWorkOrder[] = [];

      // Try AI parsing first (if enabled and key provided)
      if (aiEnabled && apiKey && isAiParsingEnabled(aiEnabled, apiKey)) {
        try {
          const profile = getIndustryProfile();
          const model = getAiModelName();
          
          // Build prompt with PDF and email text
          const prompt = `You are a Work Order Extraction Engine for ${profile.label}.

Extract ALL available work order information from the following PDF text and email text. Be thorough and extract every field that appears in the document.

EXTRACTION RULES (follow strictly):

1. COMPLETENESS: Extract EVERY field that appears in the document. Do not skip fields that are present.

2. FIELD LOCATIONS - Check these areas for each field:
   - "work_order_number": Look in headers, top of document, subject line, work order # field
   - "customer_name": Look for facility name, location name, client name, store name (e.g., "Petco # 2811")
   - "vendor_name": Facility management platform (ServiceChannel, Corrigo, FMX, etc.) - NOT the service provider. Look in email "From" field, PDF headers/footers, or work order system identifiers.
   - "service_address": Full address including street, city, state, zip - check address fields, location sections
   - "job_type": Service type, work type, category (e.g., "Floor Scrub and Buff", "HVAC Repair")
   - "job_description": Detailed description of the work to be performed - check description fields, work details sections
   - "scheduled_date": Service date, scheduled date, appointment date (convert to ISO format YYYY-MM-DD) - check date fields, schedule sections
   - "priority": Priority level if mentioned (e.g., "High", "Urgent", "Normal")
   - "amount": Look for dollar amounts, totals, invoice amounts, service fees (extract numeric only, no $ or commas) - check throughout entire document
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
   - Only return empty string "" or null if you have thoroughly searched and the field is truly not present
   - Double-check before marking a field as empty

Return a JSON object with this structure:
{
  "workOrders": [
    {
      "work_order_number": "string (required)",
      "customer_name": "string or null",
      "vendor_name": "string or null",
      "service_address": "string or null",
      "job_type": "string or null",
      "job_description": "string or null",
      "scheduled_date": "ISO date string (YYYY-MM-DD) or null",
      "priority": "string or null",
      "amount": "numeric string (no currency symbols) or null",
      "currency": "USD or other",
      "nte_amount": "numeric string or null",
      "service_category": "string or null",
      "facility_id": "string or null",
      "notes": "string or null"
    }
  ]
}

Email context:
${emailText}

PDF text:
${pdfText}`;

          const client = new OpenAI({
            apiKey,
          });

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
          console.log(`[Gmail Process] AI response received for ${pdfAttachment.filename}. Response length: ${responseText?.length || 0}`);
          if (responseText) {
            const aiResult = parseAiResponse(responseText, pdfAttachment.filename);
            console.log(`[Gmail Process] Parsed AI response: ${aiResult ? aiResult.length : 0} work order(s)`);
            if (aiResult && aiResult.length > 0) {
              parsedWorkOrders = aiResult;
              aiModelUsed = model;
              console.log(`[Gmail Process] AI parser produced ${aiResult.length} work order(s) from PDF: ${pdfAttachment.filename}`);
            } else {
              console.warn(`[Gmail Process] AI parser returned 0 work orders for ${pdfAttachment.filename}. Response: ${responseText.substring(0, 200)}`);
            }
          } else {
            console.warn(`[Gmail Process] AI response was empty for ${pdfAttachment.filename}`);
          }
        } catch (aiError) {
          console.error(`[Gmail Process] AI parsing failed for ${pdfAttachment.filename}, falling back to rule-based:`, aiError);
        }
      }

      // Fall back to rule-based parser if AI didn't produce results
      if (parsedWorkOrders.length === 0) {
        console.log(`[Gmail Process] AI parsing produced 0 work orders, trying rule-based parser for: ${pdfAttachment.filename}`);
        // Try to extract work order number from email subject or PDF filename
        let workOrderNumber: string | null = null;
        workOrderNumber = extractWorkOrderNumberFromText(email.subject);
        if (!workOrderNumber) {
          workOrderNumber = extractWorkOrderNumberFromText(pdfAttachment.filename);
        }
        
        // If still not found, set to null (will route to "Verification" sheet)
        if (!workOrderNumber) {
          console.warn(`[Gmail Process] Could not extract work order number from email subject ("${email.subject}") or PDF filename ("${pdfAttachment.filename}"). Will route to "Verification" sheet.`);
        } else {
          console.log(`[Gmail Process] Rule-based parser extracted work order number: ${workOrderNumber}`);
        }
        
        const now = new Date().toISOString();
        
        parsedWorkOrders = [{
          workOrderNumber, // Can be null - will route to "Verification"
          timestampExtracted: now,
          scheduledDate: now,
          serviceAddress: null,
          jobType: null,
          customerName: null,
          vendorName: null,
          jobDescription: email.snippet ? email.snippet.trim().slice(0, 500) : null,
          amount: null,
          currency: "USD",
          notes: emailText.trim() || null,
          priority: null,
          fmKey: null, // Will be matched later
        }];
      }

      allParsedWorkOrders.push(...parsedWorkOrders);
      console.log(`[Gmail Process] Added ${parsedWorkOrders.length} work order(s) from PDF: ${pdfAttachment.filename}. Total so far: ${allParsedWorkOrders.length}`);
    }

    console.log(`[Gmail Process] Finished processing all PDFs. Total work orders extracted: ${allParsedWorkOrders.length}`);

    // Guard: Do not process if no work orders were extracted
    if (allParsedWorkOrders.length === 0) {
      throw new Error("No work orders extracted from attachments; leaving label for retry.");
    }

    // Extract issuerKey from email sender domain
    // Parse domain from email.from (e.g., "sender@example.com" -> "example.com")
    function extractIssuerKey(fromAddress: string): string {
      const emailMatch = fromAddress.match(/@([^\s>]+)/);
      if (emailMatch && emailMatch[1]) {
        const domain = emailMatch[1].toLowerCase().trim();
        // Extract root domain (good enough for now - handles subdomains)
        const parts = domain.split(".");
        if (parts.length >= 2) {
          return parts.slice(-2).join("."); // e.g., "example.com" from "mail.example.com"
        }
        return domain;
      }
      return "unknown";
    }

    const issuerKey = extractIssuerKey(email.from);
    console.log(`[Gmail Process] Extracted issuerKey from sender: ${email.from} -> ${issuerKey}`);

    // Wrap entire processing block - label removal only happens if ALL steps succeed
    let labelRemoved = false;
    let processingError: Error | null = null;
    let skipSheets = false; // Track if Sheets writes were skipped (for warning message)
    let workspaceResult: Awaited<ReturnType<typeof import("@/lib/workspace/getWorkspace").getWorkspace>> | null = null;
    let missingFmKeyWarning: string | null = null; // Warning for missing FM profile when issuer has been processed before

    try {
      // Validate required configuration
      if (!accessToken) {
        throw new Error("No Google access token available. Cannot process email.");
      }

      // Get workspace (uses cookie module internally)
      const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
      workspaceResult = await getWorkspace();
      
      if (!workspaceResult) {
        throw new Error("Workspace not found. Please complete onboarding.");
      }
      
      const spreadsheetId = workspaceResult.workspace.spreadsheetId;
      console.log(`[Gmail Process] Using spreadsheet ID: ${spreadsheetId.substring(0, 10)}... (source: ${workspaceResult.source})`);

      // Load FM Profiles from Sheets
      const { getAllFmProfiles } = await import("@/lib/templates/fmProfilesSheets");
      let fmProfiles: Array<{ fmKey: string; fmLabel: string; senderDomains?: string; subjectKeywords?: string; page: number; xPct: number; yPct: number; wPct: number; hPct: number }> = [];
      if (spreadsheetId) {
        try {
          fmProfiles = await getAllFmProfiles({
            spreadsheetId,
            accessToken,
          });
          console.log(`[Gmail Process] Loaded ${fmProfiles.length} FM profile(s) from Sheets`);
        } catch (error) {
          console.warn(`[Gmail Process] Failed to load FM profiles (non-fatal):`, error);
          // Continue without FM profiles - jobs will have fmKey = null
        }
      }

      // Require at least one FM profile before processing
      if (fmProfiles.length === 0) {
        throw new Error("No FM Profiles configured. Please add at least one FM Profile in Settings or Onboarding before processing work orders.");
      }

      // Match FM profiles for each work order
      const { matchFmProfile } = await import("@/lib/templates/fmProfileMatching");
      console.log(`[Gmail Process] Starting FM profile matching for ${allParsedWorkOrders.length} work order(s)`);
      console.log(`[Gmail Process] Email sender: "${email.from}", subject: "${email.subject}"`);
      console.log(`[Gmail Process] Available FM profiles: ${fmProfiles.length} profile(s)`);
      
      for (const workOrder of allParsedWorkOrders) {
        const matchedProfile = matchFmProfile(fmProfiles, email.from, email.subject);
        const fmKeyBefore = workOrder.fmKey;
        workOrder.fmKey = matchedProfile ? matchedProfile.fmKey : null;
        const fmKeyAfter = workOrder.fmKey;
        
        console.log(`[Gmail Process] Work order "${workOrder.workOrderNumber}":`, {
          fmKeyBefore,
          matchedProfileFmKey: matchedProfile?.fmKey,
          fmKeyAfter,
          matched: !!matchedProfile,
        });
        
        if (matchedProfile) {
          console.log(`[Gmail Process] ✅ Matched FM profile "${matchedProfile.fmKey}" for work order "${workOrder.workOrderNumber}"`);
          console.log(`[Gmail Process] Setting fmKey="${workOrder.fmKey}" on work order`);
        } else {
          console.log(`[Gmail Process] ⚠️ No FM profile match for work order "${workOrder.workOrderNumber}" (sender: ${email.from}, subject: ${email.subject})`);
          console.log(`[Gmail Process] Available profiles: ${fmProfiles.map(p => `${p.fmKey} (senderDomains: "${p.senderDomains || ""}")`).join(", ")}`);
        }
      }
      
      // Log all work orders with their fmKeys before writing
      console.log(`[Gmail Process] 📋 Work orders with fmKeys before writing to Sheet1:`, 
        allParsedWorkOrders.map(wo => ({ 
          woNumber: wo.workOrderNumber, 
          fmKey: wo.fmKey,
          fmKeyType: typeof wo.fmKey,
          hasFmKey: wo.fmKey !== null && wo.fmKey !== undefined,
        }))
      );
      
      // Check for warning: if no FM profile matched but we've processed this issuer before
      const workOrdersWithoutFmKey = allParsedWorkOrders.filter(wo => !wo.fmKey);
      if (workOrdersWithoutFmKey.length > 0 && spreadsheetId && accessToken) {
        try {
          // Extract issuer domain from email sender
          const emailMatch = email.from.match(/@([^\s>]+)/);
          const senderDomain = emailMatch ? emailMatch[1].toLowerCase().trim() : null;
          
          if (senderDomain) {
            // Check if there are existing work orders for this issuer in Sheet1
            const { getSheetHeadersCached, createSheetsClient, formatSheetRange } = await import("@/lib/google/sheets");
            const MAIN_SHEET_NAME = "Sheet1";
            
            const headerMeta = await getSheetHeadersCached(accessToken, spreadsheetId, MAIN_SHEET_NAME);
            const issuerLetter = headerMeta.colLetterByLower["issuer"];
            
            if (issuerLetter) {
              // Read the issuer column to check for existing entries
              const sheets = createSheetsClient(accessToken);
              const issuerColResp = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: formatSheetRange(MAIN_SHEET_NAME, `${issuerLetter}:${issuerLetter}`),
              });
              
              const issuerValues = issuerColResp.data.values || [];
              // Check if any row (skip header) contains this issuer domain
              let foundExistingIssuer = false;
              for (let i = 1; i < issuerValues.length; i++) {
                const cellValue = (issuerValues[i]?.[0] || "").toLowerCase().trim();
                if (cellValue && (cellValue === senderDomain || cellValue.includes(senderDomain) || senderDomain.includes(cellValue))) {
                  foundExistingIssuer = true;
                  break;
                }
              }
              
              if (foundExistingIssuer) {
                missingFmKeyWarning = `⚠️ Warning: No FM profile configured for "${senderDomain}", but work orders from this issuer have been processed before. Please configure an FM profile to ensure proper processing.`;
                console.warn(`[Gmail Process] ${missingFmKeyWarning}`);
              }
            }
          }
        } catch (warningError) {
          // Non-fatal: if we can't check, just log and continue
          console.warn(`[Gmail Process] Could not check for existing issuer in Sheets:`, warningError);
        }
      }
      
      // In dev mode, allow processing without Sheets (for testing parsing logic)
      const isDevMode = process.env.NODE_ENV !== "production";
      skipSheets = !spreadsheetId && isDevMode;
      
      if (!spreadsheetId && !skipSheets) {
        throw new Error("No Google Sheets spreadsheet ID configured. Please configure in Settings.");
      }

      if (skipSheets) {
        console.warn("[Gmail Process] ⚠️  No spreadsheet ID configured. Skipping Sheets/Drive writes (dev mode).");
        console.warn("[Gmail Process] Parsed work orders will be returned but not persisted.");
      } else {
        console.log("[Gmail Process] Writing work orders to Sheets + Drive:", {
          spreadsheetId: `${spreadsheetId!.substring(0, 10)}...`,
          workOrdersCount: allParsedWorkOrders.length,
          pdfCount: pdfsToProcess.length,
          messageId,
        });

        // Collect PDF buffers for upload
        const pdfBuffers: Buffer[] = [];
        const pdfFilenames: string[] = [];
        
        for (const pdfAttachment of pdfsToProcess) {
          pdfBuffers.push(pdfAttachment.data);
          pdfFilenames.push(pdfAttachment.filename);
        }

        // Write to Sheets with PDF upload to Drive
        // This will throw if ANY step fails (Drive upload OR Sheets write)
        // Extract full work order details from PDFs BEFORE uploading (one-time extraction)
        const { writeWorkOrdersToSheets } = await import("@/lib/workOrders/sheetsIngestion");
        await writeWorkOrdersToSheets(
          allParsedWorkOrders,
          accessToken,
          spreadsheetId!,
          issuerKey, // Use issuerKey from email sender domain (stable)
          pdfBuffers.length > 0 ? pdfBuffers : undefined,
          pdfFilenames.length > 0 ? pdfFilenames : undefined,
          "email", // Source: Gmail processing
          aiEnabled, // Pass AI enabled flag
          apiKey, // Pass OpenAI key for extraction
          email.subject // Pass email subject for context
        );
        
        console.log("[Gmail Process] Successfully wrote work orders to Sheets + Drive");

        // Also write to Work_Orders sheet (master ledger, no duplicates)
        const { writeWorkOrderRecord, findWorkOrderRecordByJobId } = await import("@/lib/google/sheets");
        const { generateJobId } = await import("@/lib/workOrders/sheetsIngestion");
        const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";
        const nowIso = new Date().toISOString();

        // Get PDF URLs from the writeWorkOrdersToSheets result
        // Note: writeWorkOrdersToSheets uploads PDFs but doesn't return URLs
        // We'll need to get them from the main sheet or upload separately
        // For now, we'll set work_order_pdf_link to null and it can be updated later
        
        for (const parsedWO of allParsedWorkOrders) {
          const jobId = generateJobId(issuerKey, parsedWO.workOrderNumber);
          
          console.log(`[Gmail Process] Writing to Work_Orders for work order "${parsedWO.workOrderNumber}":`, {
            jobId,
            parsedWOFmKey: parsedWO.fmKey,
            parsedWOFmKeyType: typeof parsedWO.fmKey,
            workOrderNumber: parsedWO.workOrderNumber,
          });
          
          const workOrderRecord: WorkOrderRecord = {
            jobId,
            fmKey: parsedWO.fmKey ?? null,
            wo_number: parsedWO.workOrderNumber || "MISSING",
            status: "OPEN",
            scheduled_date: parsedWO.scheduledDate ?? null,
            created_at: parsedWO.timestampExtracted || nowIso,
            timestamp_extracted: nowIso,
            customer_name: parsedWO.customerName ?? null,
            vendor_name: parsedWO.vendorName ?? null,
            service_address: parsedWO.serviceAddress ?? null,
            job_type: parsedWO.jobType ?? null,
            job_description: parsedWO.jobDescription ?? null,
            amount: parsedWO.amount != null ? String(parsedWO.amount) : null,
            currency: parsedWO.currency ?? null,
            notes: parsedWO.notes ?? null,
            priority: parsedWO.priority ?? null,
            calendar_event_link: null,
            work_order_pdf_link: null, // Will be updated from main sheet if needed
            signed_pdf_url: null,
            signed_preview_image_url: null,
            signed_at: null,
            source: "email",
            last_updated_at: nowIso,
            file_hash: null, // Gmail processing: multiple PDFs may map to multiple work orders, hash not directly mappable
          };

          try {
            console.log(`[Gmail Process] Writing to Work_Orders sheet:`, {
              jobId,
              fmKey: parsedWO.fmKey,
              woNumber: parsedWO.workOrderNumber,
              spreadsheetId: `${spreadsheetId!.substring(0, 10)}...`,
              sheetName: WORK_ORDERS_SHEET_NAME,
              envSheetName: process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME,
            });
            
            await writeWorkOrderRecord(
              accessToken,
              spreadsheetId!,
              WORK_ORDERS_SHEET_NAME,
              workOrderRecord
            );
            
            // Don't verify immediately - saves a read request and avoids quota issues
            // The write operation itself will succeed or fail, and we log that
            console.log(`[Gmail Process] ✅ Work_Orders sheet updated:`, {
              jobId,
              fmKey: workOrderRecord.fmKey,
              woNumber: workOrderRecord.wo_number,
              status: workOrderRecord.status,
            });
          } catch (woError) {
            // Log but don't fail the request
            console.error(`[Gmail Process] Error writing to Work_Orders sheet for ${jobId}:`, {
              error: woError,
              message: woError instanceof Error ? woError.message : String(woError),
              stack: woError instanceof Error ? woError.stack : undefined,
              jobId,
              spreadsheetId: `${spreadsheetId!.substring(0, 10)}...`,
              sheetName: WORK_ORDERS_SHEET_NAME,
            });
          }
        }
      }

      // ALL steps succeeded - now handle labels (if requested)
      // Note: In dev mode without Sheets, we still handle labels since parsing succeeded
      if (autoRemoveLabel) {
        try {
          // Load workspace to get label configuration
          const workspace = await loadWorkspace();
          
          if (workspace?.labels) {
            // Transition to processed state (idempotent)
            const success = await transitionToProcessed(accessToken, messageId, workspace.labels);
            if (success) {
              labelRemoved = true;
              console.log(`[Gmail Process] Transitioned message ${messageId} to processed state`);
            } else {
              console.warn(`[Gmail Process] Failed to transition message ${messageId} to processed state`);
            }
          } else {
            console.warn(`[Gmail Process] Workspace labels not found, skipping label operations`);
          }
        } catch (labelError) {
          // Label operations failed - log but don't fail the request since processing succeeded
          console.error(`[Gmail Process] Failed to handle labels for message ${messageId}:`, labelError);
          // Note: labelRemoved remains false, but processing succeeded
        }
      }

    } catch (error) {
      // Processing failed - transition to needs review (if configured)
      processingError = error instanceof Error ? error : new Error(String(error));
      
      // Try to transition to needs review state (idempotent, only if configured)
      try {
        const workspace = await loadWorkspace();
        if (workspace?.labels) {
          await transitionToNeedsReview(accessToken, messageId, workspace.labels);
          console.log(`[Gmail Process] Transitioned message ${messageId} to needs review state`);
        }
      } catch (labelError) {
        // Label transition failed - log but don't fail the request
        console.error(`[Gmail Process] Failed to transition message ${messageId} to needs review:`, labelError);
      }
      console.error(`[Gmail Process] Processing failed for message ${messageId}:`, {
        message: processingError.message,
        stack: processingError.stack,
        emailId: messageId,
        pdfCount: pdfsToProcess.length,
        pdfFilenames: pdfsToProcess.map(p => p.filename),
      });

      // Re-throw to return error response (label will remain intact)
      throw processingError;
    }

    // Generate CSV from all parsed work orders (only if we got here = success)
    const csv = await generateCsv(allParsedWorkOrders, issuerKey);

    // Return parsed work orders and CSV
    const responseData: ManualProcessResponse = {
      workOrders: allParsedWorkOrders,
      csv,
      meta: {
        fileCount: pdfsToProcess.length, // Number of PDFs actually processed (may be less than total if multiple attachments)
        processedAt,
        source: "gmail",
        messageId,
        labelRemoved,
        ...(skipSheets ? { 
          warning: "No Google Sheets spreadsheet ID configured. Work orders were parsed but not saved to Sheets/Drive. Please configure in Settings." 
        } : missingFmKeyWarning ? {
          warning: missingFmKeyWarning
        } : {}),
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

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json(responseData, { status: 200 });
    if (workspaceResult && workspaceResult.source === "users_sheet") {
      const { rehydrateWorkspaceCookies } = await import("@/lib/workspace/workspaceCookies");
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }

    return response;
  } catch (error) {
    console.error("Error processing Gmail email:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process Gmail email";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

