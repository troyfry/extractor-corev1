/**
 * 3-layer work order number extraction orchestrator.
 * 
 * Flow: Digital Text → OCR → AI Rescue
 * 
 * This is a simplified extraction flow for signed documents that doesn't require
 * template coordinates. It's designed to work with minimal inputs.
 */

import { extractTextFromPdfBuffer } from "@/lib/workOrders/aiParser";
import { extractCandidatesFromText } from "@/lib/workOrders/signedDecisionEngine";
import { callSignedOcrService } from "@/lib/workOrders/signedOcr";
import { isAiParsingEnabled, getAiModelName, getIndustryProfile } from "@/lib/config/ai";
import { OpenAI } from "openai";
import type { ExtractionResult, ExtractMethod, ExtractionCandidate } from "./extractionTypes";

export interface ExtractWorkOrderNumberParams {
  pdfBuffer?: Buffer;
  pdfText?: string;
  pageImageUrl?: string | null;
  aiEnabled?: boolean;
  openaiKey?: string | null;
  fmKey?: string | null;
  // Optional OCR template coordinates (if available)
  ocrConfig?: {
    page: number;
    xPt: number;
    yPt: number;
    wPt: number;
    hPt: number;
    pageWidthPt: number;
    pageHeightPt: number;
    dpi?: number;
  };
  // Expected digits for work order number (default: 7)
  expectedDigits?: number;
}

/**
 * Extract work order number using 3-layer flow: Digital → OCR → AI Rescue
 */
export async function extractWorkOrderNumber(
  params: ExtractWorkOrderNumberParams
): Promise<ExtractionResult> {
  const {
    pdfBuffer,
    pdfText: providedPdfText,
    pageImageUrl,
    aiEnabled,
    openaiKey,
    fmKey,
    ocrConfig,
    expectedDigits = 7,
  } = params;

  // ============================================
  // Layer A: Digital Text Extraction (Fast, Deterministic)
  // ============================================
  let digitalText = providedPdfText || "";
  let digitalCandidates: string[] = [];

  if (!digitalText && pdfBuffer) {
    try {
      digitalText = await extractTextFromPdfBuffer(pdfBuffer);
    } catch (error) {
      // Digital extraction failed (scanned PDF, etc.) - will fall back to OCR
      console.log("[Extract WO] Digital text extraction failed:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (digitalText && digitalText.trim().length > 0) {
    digitalCandidates = extractCandidatesFromText(digitalText, expectedDigits);
  }

  // Determine confidence for digital extraction
  if (digitalCandidates.length === 1) {
    // Single strong match
    const candidate = digitalCandidates[0];
    // Extract digits only for the work order number
    const digitsOnly = candidate.replace(/\D/g, "");
    if (digitsOnly.length === expectedDigits) {
      return {
        workOrderNumber: digitsOnly,
        method: "DIGITAL_TEXT",
        confidence: 0.98,
        rationale: "Found single work order number in digital text",
        candidates: [
          {
            value: digitsOnly,
            score: 0.98,
            source: "DIGITAL_TEXT",
          },
        ],
        debug: {
          digitalTextLength: digitalText.length,
          candidateCount: digitalCandidates.length,
        },
      };
    }
  }

  if (digitalCandidates.length > 1) {
    // Multiple candidates - lower confidence
    const bestCandidate = digitalCandidates[0];
    const digitsOnly = bestCandidate.replace(/\D/g, "");
    if (digitsOnly.length === expectedDigits) {
      return {
        workOrderNumber: digitsOnly,
        method: "DIGITAL_TEXT",
        confidence: 0.85,
        rationale: `Found ${digitalCandidates.length} candidates in digital text; using best match`,
        candidates: digitalCandidates.slice(0, 5).map((c) => ({
          value: c.replace(/\D/g, ""),
          score: 0.85 - digitalCandidates.indexOf(c) * 0.1,
          source: "DIGITAL_TEXT" as ExtractMethod,
        })),
        debug: {
          digitalTextLength: digitalText.length,
          candidateCount: digitalCandidates.length,
        },
      };
    }
  }

  // Digital extraction didn't yield high confidence result
  // Continue to OCR if available

  // ============================================
  // Layer B: OCR Pass (Fallback)
  // ============================================
  if (ocrConfig && pdfBuffer) {
    try {
      const ocrResult = await callSignedOcrService(pdfBuffer, "extraction.pdf", {
        templateId: fmKey || "extraction",
        page: ocrConfig.page,
        region: null,
        dpi: ocrConfig.dpi || 200,
        xPt: ocrConfig.xPt,
        yPt: ocrConfig.yPt,
        wPt: ocrConfig.wPt,
        hPt: ocrConfig.hPt,
        pageWidthPt: ocrConfig.pageWidthPt,
        pageHeightPt: ocrConfig.pageHeightPt,
      });

      if (ocrResult.woNumber && ocrResult.confidenceRaw >= 0.80) {
        // Extract digits only
        const digitsOnly = ocrResult.woNumber.replace(/\D/g, "");
        if (digitsOnly.length === expectedDigits || digitsOnly.length >= expectedDigits - 1) {
          return {
            workOrderNumber: digitsOnly,
            method: "OCR",
            confidence: Math.min(ocrResult.confidenceRaw, 0.94),
            rationale: `OCR extracted work order number with ${Math.round(ocrResult.confidenceRaw * 100)}% confidence`,
            candidates: [
              {
                value: digitsOnly,
                score: ocrResult.confidenceRaw,
                source: "OCR",
              },
            ],
            debug: {
              ocrConfidenceRaw: ocrResult.confidenceRaw,
              ocrConfidenceLabel: ocrResult.confidenceLabel,
              rawText: ocrResult.rawText?.substring(0, 100),
            },
          };
        }
      }

      // OCR found something but low confidence
      if (ocrResult.woNumber && ocrResult.confidenceRaw >= 0.60) {
        const digitsOnly = ocrResult.woNumber.replace(/\D/g, "");
        if (digitsOnly.length >= expectedDigits - 1) {
          // Lower confidence OCR result - continue to AI rescue for better confidence
          // But we'll use this as a fallback if AI fails
        }
      }
    } catch (error) {
      console.log("[Extract WO] OCR extraction failed:", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue to AI rescue
    }
  }

  // ============================================
  // Layer C: AI Rescue (Last Resort)
  // ============================================
  if (aiEnabled && openaiKey && isAiParsingEnabled(aiEnabled, openaiKey)) {
    try {
      const profile = getIndustryProfile();
      const model = getAiModelName();

      // Build prompt with available text
      let promptText = "";
      if (digitalText) {
        promptText += `PDF Text:\n${digitalText.substring(0, 4000)}\n\n`;
      }
      if (pageImageUrl) {
        promptText += `Note: A page image is available at: ${pageImageUrl}\n\n`;
      }

      const prompt = `You are a Work Order Number Extraction Engine for ${profile.label}.

Extract ONLY the work order number from the following text. The work order number is typically ${expectedDigits} digits long, but may be ${expectedDigits - 1} to ${expectedDigits + 1} digits.

${promptText}

Return a JSON object with this exact structure:
{
  "work_order_number": "the extracted number (digits only, or null if not found)",
  "rationale": "brief explanation of where you found it or why extraction failed"
}

IMPORTANT: Return ONLY the JSON object, no markdown, no code blocks, no explanations.`;

      const client = new OpenAI({ apiKey: openaiKey });
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a highly accurate Work Order Number Extraction Engine. Always respond with valid JSON only, no explanations.",
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
          const woNumber = parsed.work_order_number;
          const rationale = parsed.rationale || "AI extracted work order number";

          if (woNumber && typeof woNumber === "string") {
            const digitsOnly = woNumber.replace(/\D/g, "");
            if (digitsOnly.length >= expectedDigits - 1 && digitsOnly.length <= expectedDigits + 1) {
              return {
                workOrderNumber: digitsOnly,
                method: "AI_RESCUE",
                confidence: 0.85, // Cap at 0.85 as specified
                rationale: rationale,
                candidates: [
                  {
                    value: digitsOnly,
                    score: 0.85,
                    source: "AI_RESCUE",
                  },
                ],
                debug: {
                  aiModel: model,
                  rawResponse: responseText.substring(0, 200),
                },
              };
            }
          }
        } catch (parseError) {
          console.log("[Extract WO] Failed to parse AI response:", parseError);
        }
      }
    } catch (error) {
      console.log("[Extract WO] AI rescue failed:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ============================================
  // No extraction succeeded
  // ============================================
  const bestCandidate =
    digitalCandidates.length > 0
      ? digitalCandidates[0].replace(/\D/g, "")
      : null;

  return {
    workOrderNumber: bestCandidate && bestCandidate.length >= expectedDigits - 1 ? bestCandidate : null,
    method: digitalCandidates.length > 0 ? "DIGITAL_TEXT" : "OCR",
    confidence: bestCandidate ? 0.70 : 0.0,
    rationale: bestCandidate
      ? "Found candidate but confidence too low for automatic processing"
      : "No clear work order number found; low scan quality or missing text",
    candidates: digitalCandidates.slice(0, 3).map((c) => ({
      value: c.replace(/\D/g, ""),
      score: 0.70 - digitalCandidates.indexOf(c) * 0.1,
      source: "DIGITAL_TEXT" as ExtractMethod,
    })),
    debug: {
      digitalTextLength: digitalText.length,
      candidateCount: digitalCandidates.length,
      hasOcrConfig: !!ocrConfig,
      aiEnabled: !!aiEnabled,
    },
  };
}
