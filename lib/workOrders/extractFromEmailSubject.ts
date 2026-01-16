/**
 * Extract work order fields from email subject line using AI.
 * 
 * Email subjects often contain:
 * - Scheduled date
 * - NTE (Not To Exceed) amount
 * - Location/service address
 * - Work order number (already extracted separately)
 * 
 * This function uses OpenAI to parse the subject line and extract these fields.
 */

import { OpenAI } from "openai";
import { isAiParsingEnabled, getAiModelName } from "@/lib/config/ai";

export interface EmailSubjectExtraction {
  scheduledDate: string | null; // ISO format YYYY-MM-DD
  nteAmount: string | null; // Numeric string
  serviceAddress: string | null; // Full address
  location: string | null; // Location name/identifier
}

/**
 * Extract work order fields from email subject using AI.
 * 
 * @param emailSubject The email subject line
 * @param aiEnabled Whether AI is enabled
 * @param openaiKey OpenAI API key
 * @returns Extracted fields or null if extraction fails
 */
export async function extractFromEmailSubject(
  emailSubject: string,
  aiEnabled?: boolean,
  openaiKey?: string | null
): Promise<EmailSubjectExtraction | null> {
  if (!emailSubject || !emailSubject.trim()) {
    return null;
  }

  if (!aiEnabled || !openaiKey || !isAiParsingEnabled(aiEnabled, openaiKey)) {
    return null;
  }

  try {
    const model = getAiModelName();
    const client = new OpenAI({ apiKey: openaiKey });

    const prompt = `You are a Work Order Email Subject Parser.

Extract the following fields from this email subject line:
- scheduled_date: Service date, scheduled date, appointment date (convert to ISO format YYYY-MM-DD)
- nte_amount: "Not To Exceed" amount if present (extract numeric only, no $ or commas)
- service_address: Full address if present (street, city, state, zip)
- location: Location name, facility name, store name, or location identifier if present

Email Subject: "${emailSubject}"

Return a JSON object with this exact structure:
{
  "scheduled_date": "ISO date string (YYYY-MM-DD) or null",
  "nte_amount": "numeric string (no currency symbols) or null",
  "service_address": "full address string or null",
  "location": "location name/identifier or null"
}

IMPORTANT:
- Return ONLY the JSON object, no markdown, no code blocks, no explanations.
- For dates, convert to ISO format (YYYY-MM-DD). If date is relative (e.g., "tomorrow", "next week"), use null.
- For amounts, extract ONLY numeric characters (remove $, commas, spaces).
- If a field is not present, return null for that field.`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a highly accurate Email Subject Parser. Always respond with valid JSON only, no explanations.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const responseText = response.choices[0]?.message?.content;
    if (!responseText) {
      return null;
    }

    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    }

    const parsed = JSON.parse(jsonText);

    // Sanitize NTE amount
    const sanitizeAmount = (amountStr: string | null | undefined): string | null => {
      if (!amountStr || typeof amountStr !== "string") return null;
      const sanitized = amountStr.replace(/[^0-9.]/g, "");
      if (!sanitized || sanitized === ".") return null;
      const num = parseFloat(sanitized);
      return Number.isNaN(num) ? null : num.toFixed(2);
    };

    return {
      scheduledDate: parsed.scheduled_date || null,
      nteAmount: sanitizeAmount(parsed.nte_amount),
      serviceAddress: parsed.service_address || null,
      location: parsed.location || null,
    };
  } catch (error) {
    console.error("[Extract From Email Subject] Failed to extract from email subject:", error);
    return null;
  }
}
