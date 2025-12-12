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
import { getEmailWithPdfAttachments, removeWorkOrderLabel } from "@/lib/google/gmail";
import { extractWorkOrderNumberFromText } from "@/lib/workOrders/processing";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { Plan } from "@/lib/plan";
import { extractTextFromPdfBuffer as extractTextFromPdfBufferAiParser } from "@/lib/workOrders/aiParser";
import OpenAI from "openai";
import type { ParsedWorkOrder, ManualProcessResponse } from "@/lib/workOrders/parsedTypes";

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

type AiParserResponse = {
  workOrders: AiWorkOrder[];
};

/**
 * Extract text from a PDF Buffer.
 * Uses the same extraction method as the manual upload (from aiParser.ts).
 * This function has better error handling and fallback to pdfjs-dist.
 */
async function extractTextFromPdfBuffer(buffer: Buffer, filename: string): Promise<string> {
  try {
    console.log(`[Gmail Process] Extracting text from PDF buffer (size: ${buffer.length} bytes, filename: ${filename})`);
    
    // Use the same extraction function as manual upload (from aiParser.ts)
    // This function has better error handling and fallback to pdfjs-dist
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
function generateCsv(workOrders: ParsedWorkOrder[]): string {
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

      // Pro/Premium plans use server-side OpenAI key only
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("Missing OPENAI_API_KEY environment variable");
        return NextResponse.json(
          { error: "Server configuration error: OpenAI API key not configured" },
          { status: 500 }
        );
      }

      // Try AI parsing first (if enabled)
      if (isAiParsingEnabled()) {
        try {
          const profile = getIndustryProfile();
          const model = getAiModelName();
          
          // Build prompt with PDF and email text
          let prompt = `You are a Work Order Extraction Engine for ${profile.label}.

Extract work order information from the following PDF text and email text and return it as JSON.

IMPORTANT FIELD CLARIFICATIONS:
- "vendor_name": This is the Facility Management Platform/Company that *sends* the work order (e.g., ServiceChannel, Corrigo, FMX, Hippo, ServiceTrade, Brightly). It is NOT the service provider or contractor (e.g., a cleaning company, HVAC company, etc.) that performs the work. Look for this in the email "From" field, PDF headers/footers, or work order system identifiers.
- "customer_name": This is the job site, client, or facility where the work is to be performed.
- "service_address": This is the physical address where the work is to be done.

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
      "scheduled_date": "ISO date string or null",
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
        
        // If still not found, generate a fallback work order number
        if (!workOrderNumber) {
          // Use message ID and timestamp as fallback
          const fallbackId = messageId.slice(0, 8);
          const timestamp = Date.now().toString().slice(-6);
          workOrderNumber = `UNKNOWN-${fallbackId}-${timestamp}`;
          console.warn(`[Gmail Process] Could not extract work order number from email subject ("${email.subject}") or PDF filename ("${pdfAttachment.filename}"). Using fallback: ${workOrderNumber}`);
        } else {
          console.log(`[Gmail Process] Rule-based parser extracted work order number: ${workOrderNumber}`);
        }
        
        const now = new Date().toISOString();
        
        parsedWorkOrders = [{
          workOrderNumber,
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
        }];
      }

      allParsedWorkOrders.push(...parsedWorkOrders);
      console.log(`[Gmail Process] Added ${parsedWorkOrders.length} work order(s) from PDF: ${pdfAttachment.filename}. Total so far: ${allParsedWorkOrders.length}`);
    }

    console.log(`[Gmail Process] Finished processing all PDFs. Total work orders extracted: ${allParsedWorkOrders.length}`);

    // Generate CSV from all parsed work orders
    const csv = generateCsv(allParsedWorkOrders);

    // Remove label if requested and processing succeeded
    let labelRemoved = false;
    if (autoRemoveLabel && allParsedWorkOrders.length > 0) {
      try {
        labelRemoved = await removeWorkOrderLabel(accessToken, messageId);
      } catch (labelError) {
        // Log error but don't fail the request - parsing succeeded
        console.error("Failed to remove label (non-fatal):", labelError);
      }
    }

    // Return parsed work orders and CSV (no database writes)
    const response: ManualProcessResponse = {
      workOrders: allParsedWorkOrders,
      csv,
      meta: {
        fileCount: pdfsToProcess.length, // Number of PDFs actually processed (may be less than total if multiple attachments)
        processedAt,
        source: "gmail",
        messageId,
        labelRemoved,
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
    console.error("Error processing Gmail email:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process Gmail email";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

