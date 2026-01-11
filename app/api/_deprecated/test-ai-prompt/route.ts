/**
 * Test endpoint for AI prompt testing.
 * 
 * POST /api/test-ai-prompt
 * Body: {
 *   emailSubject: string,
 *   emailBody?: string,
 *   pdfText?: string,
 *   testPromptOnly?: boolean  // if true, just return the prompt without calling OpenAI
 * }
 * 
 * Response: {
 *   prompt: string,
 *   aiResponse?: string,
 *   parsedResult?: WorkOrderInput[],
 *   error?: string
 * }
 */
import { NextResponse } from "next/server";
import { getIndustryProfile } from "@/lib/config/ai";
import type { EmailMessage } from "@/lib/emailMessages/types";

// Import the prompt builder function
// We'll need to extract it or make it accessible
function buildTestPrompt(
  emailSubject: string,
  emailBody: string,
  pdfText: string
): string {
  const profile = getIndustryProfile();
  
  const examplesSection = profile.examples
    ? `\n\n${profile.examples}\n`
    : "";

  // Use current date as receivedAt for testing
  const receivedAt = new Date().toISOString();

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
   - If no date is found, use the email received date: ${receivedAt}

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

7. VENDOR/FACILITY COMPANY
   - Extract "vendor_name" as the company/vendor name that is sending the work order.
   - This is different from "customer_name" (the job site/client).
   - Look for vendor names like: ServiceChannel, Corrigo, FMX, Hippo, etc.
   - Or the company name in the email "From" field if it's a vendor.
   - If not found, return "".

8. INDUSTRY-SPECIFIC TERMINOLOGY
   - For "job_type" and "service_category", use terminology appropriate for ${profile.label}.
   - Extract job types and categories that are common in this industry context.

-----------------------
INPUT DATA
-----------------------

EMAIL SUBJECT:
${emailSubject}

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { emailSubject, emailBody = "", pdfText = "", testPromptOnly = true } = body;

    if (!emailSubject) {
      return NextResponse.json(
        { error: "emailSubject is required" },
        { status: 400 }
      );
    }

    // Build the prompt
    const prompt = buildTestPrompt(emailSubject, emailBody, pdfText);

    // If only testing the prompt, return it without calling OpenAI
    if (testPromptOnly) {
      return NextResponse.json(
        {
          prompt,
          message: "Prompt generated successfully. Set testPromptOnly=false to test with OpenAI.",
        },
        { status: 200 }
      );
    }

    // Test with OpenAI if API key is available
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          prompt,
          error: "OPENAI_API_KEY not set. Set testPromptOnly=true to see the prompt only.",
        },
        { status: 200 }
      );
    }

    // Call OpenAI
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL_NAME || "gpt-4o-mini";

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
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const responseText = response.choices[0]?.message?.content || "";

    // Try to parse the response
    let parsedResult = null;
    try {
      const parsed = JSON.parse(responseText);
      parsedResult = parsed.workOrders || [];
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
    }

    return NextResponse.json(
      {
        prompt,
        aiResponse: responseText,
        parsedResult,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in POST /api/test-ai-prompt", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Server error",
      },
      { status: 500 }
    );
  }
}

