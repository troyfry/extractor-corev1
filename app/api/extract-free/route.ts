import { NextResponse } from "next/server";
import { extractWorkOrderNumberFromText } from "@/lib/workOrders/processing";
import { extractTextFromPdfBuffer } from "@/lib/workOrders/aiParser";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import type { ParsedWorkOrder, ManualProcessResponse } from "@/lib/workOrders/parsedTypes";
import OpenAI from "openai";

export const runtime = "nodejs";

// ✅ Makes browser visits predictable (no 500)
export async function GET() {
  return NextResponse.json(
    { ok: false, message: "Use POST with multipart/form-data (field name: file)" },
    { status: 405 }
  );
}

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

type AiParserResponse = { workOrders: AiWorkOrder[] };

function parseAiResponse(responseText: string, filename: string): ParsedWorkOrder[] | null {
  try {
    let jsonText = responseText.trim();
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (codeBlockMatch) jsonText = codeBlockMatch[1];

    const parsed = JSON.parse(jsonText) as AiParserResponse;
    if (!parsed.workOrders || !Array.isArray(parsed.workOrders)) return null;

    const sanitizeAmountString = (amountStr: string | null | undefined): string | null => {
      if (!amountStr || typeof amountStr !== "string") return null;
      const sanitized = amountStr.replace(/[^0-9.]/g, "");
      if (!sanitized || sanitized === ".") return null;
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
        workOrderNumber: wo.work_order_number || `UNKNOWN-${filename.slice(0, 8)}`,
        timestampExtracted: now,
        scheduledDate: wo.scheduled_date || now,
        serviceAddress: wo.service_address || null,
        jobType: wo.job_type || null,
        customerName: wo.customer_name || null,
        vendorName: wo.vendor_name || null,
        jobDescription: wo.job_description || null,
        amount,
        currency: wo.currency || "USD",
        notes: notes || null,
        priority: wo.priority || null,
      };
    });
  } catch {
    return null;
  }
}

function generateCsv(workOrders: ParsedWorkOrder[]): string {
  const escapeCsvValue = (value: string | null | undefined): string => {
    if (value === null || value === undefined) return "";
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

  return [headers.map(escapeCsvValue).join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export async function POST(request: Request) {
  try {
    console.log("[extract-free] POST hit");

    // ✅ Lazy import: prevents module-load 500s
    const { checkFreeLimits, incrementFreeUsage } = await import("@/lib/limits/checkFreeLimits");

    // Extract IP with fallbacks for various proxy/CDN setups
    const forwardedFor = request.headers.get("x-forwarded-for");
    const realIp =
      (forwardedFor ? forwardedFor.split(",")[0].trim() : null) ||
      request.headers.get("x-real-ip") ||
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("true-client-ip");

    // Strip port if present (e.g., "192.168.1.1:8080" -> "192.168.1.1")
    // Normalize localhost variants (::1 and 127.0.0.1 are treated consistently)
    let ip = realIp
      ? realIp.replace(/:\d+$/, "").trim() // strip :port if present
      : "unknown";
    
    // Normalize localhost variants for consistency
    if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") {
      ip = "127.0.0.1";
    }

    const limitCheck = await checkFreeLimits({ ip });
    if (!limitCheck.allowed) {
      const reasonMessages: Record<string, string> = {
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

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const header = buffer.subarray(0, 5).toString("utf8");
    if (header !== "%PDF-") {
      return NextResponse.json({ error: "Upload did not arrive as a valid PDF." }, { status: 400 });
    }

    const pdfText = await extractTextFromPdfBuffer(buffer);
    if (!pdfText || pdfText.trim().length === 0) {
      return NextResponse.json(
        { error: "PDF appears to be empty or contains no extractable text" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server configuration error: OpenAI API key not configured" },
        { status: 500 }
      );
    }

    let parsedWorkOrders: ParsedWorkOrder[] = [];

    if (isAiParsingEnabled()) {
      try {
        const profile = getIndustryProfile();
        const model = getAiModelName();
        
        let prompt = `You are a highly accurate Work Order Extraction Engine for ${profile.label}.

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
}`;

        const client = new OpenAI({ apiKey });
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "Return valid JSON only." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        });
        
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
          }
        }
      } catch {
        // fall through to rule-based
      }
    }

    if (parsedWorkOrders.length === 0) {
      let workOrderNumber: string | null = null;
      if (emailText) workOrderNumber = extractWorkOrderNumberFromText(emailText);
      if (!workOrderNumber) workOrderNumber = extractWorkOrderNumberFromText(file.name);

      if (!workOrderNumber) {
        return NextResponse.json(
          { 
            error:
              "Could not extract work order number from PDF filename or email text.",
          },
          { status: 400 }
        );
      }
      
      const now = new Date().toISOString();
      parsedWorkOrders = [
        {
        workOrderNumber,
        timestampExtracted: now,
        scheduledDate: now,
        serviceAddress: null,
        jobType: null,
        customerName: null,
        vendorName: null,
          jobDescription: emailText ? emailText.trim().slice(0, 500) : null,
        amount: null,
        currency: "USD",
          notes: emailText ? emailText.trim() : null,
        priority: null,
        },
      ];
    }

    const csv = generateCsv(parsedWorkOrders);

    // increment usage AFTER success
    try {
      console.log(`[extract-free] Attempting to increment usage for IP: ${ip || "unknown"}`);
      await incrementFreeUsage({ ip });
      console.log(`[extract-free] Successfully incremented usage counters`);
    } catch (e) {
      console.error("[extract-free] incrementFreeUsage failed:", e);
      if (e instanceof Error) {
      console.error("[extract-free] Error details:", {
          message: e.message,
          stack: e.stack,
          name: e.name,
      });
      }
      // Don't fail the request - usage tracking is best-effort
    }

    const response: ManualProcessResponse = {
      workOrders: parsedWorkOrders,
      csv,
      meta: {
        fileCount: 1,
        processedAt,
        source: "manual",
        ...(aiModelUsed ? { aiModel: aiModelUsed } : {}),
        ...(totalTokens > 0
          ? {
          tokenUsage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
                totalTokens,
          },
            }
          : {}),
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error in POST /api/extract-free", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process PDF" },
      { status: 500 }
    );
  }
}
