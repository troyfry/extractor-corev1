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
import {
  WO_NUMBER_AUTHORITY_POLICY,
  type WoNumberMethod,
  type ExtractionPipelinePath,
  type InputScope,
  type ExtractionReason,
  hasWoNumberRegion,
} from "./fieldAuthorityPolicy";
import { createHash } from "crypto";

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
  // IMPORTANT: If OCR config is available, we should use OCR text (cropped region) instead of full PDF
  // This prevents extracting PO boxes, addresses, and other irrelevant numbers from the full document
  let digitalText = providedPdfText || "";
  let digitalCandidates: string[] = [];
  let croppedOcrText: string | null = null; // Text from cropped OCR region (more accurate)

  // If OCR config is available, get cropped text first (more accurate than full PDF)
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

      // Use OCR text from cropped region (more accurate - only the work order number area)
      if (ocrResult.rawText && ocrResult.rawText.trim().length > 0) {
        croppedOcrText = ocrResult.rawText;
        console.log("[Extract WO] Using cropped OCR text for extraction (from FM coordinates):", {
          textLength: croppedOcrText.length,
          preview: croppedOcrText.substring(0, 100),
        });
      }
    } catch (error) {
      console.log("[Extract WO] OCR extraction failed, will use full PDF text:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Prefer cropped OCR text over full PDF text (more accurate)
  const textToUse = croppedOcrText || digitalText;

  if (!textToUse && pdfBuffer && !croppedOcrText) {
    // Only extract full PDF text if we don't have cropped OCR text
    try {
      digitalText = await extractTextFromPdfBuffer(pdfBuffer);
    } catch (error) {
      // Digital extraction failed (scanned PDF, etc.) - will fall back to OCR
      console.log("[Extract WO] Digital text extraction failed:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const finalText = croppedOcrText || digitalText;
  // Extract candidates and their source snippets (line context)
  const candidateSnippets = new Map<string, string>(); // candidate -> snippet
  
  if (finalText && finalText.trim().length > 0) {
    digitalCandidates = extractCandidatesFromText(finalText, expectedDigits);
    
    // Extract source snippets for each candidate (for context)
    if (digitalCandidates.length > 0) {
      const lines = finalText.split(/\n/);
      for (const candidate of digitalCandidates) {
        // Find the line containing this candidate
        for (const line of lines) {
          if (line.includes(candidate) || candidate.includes(line.trim())) {
            // Store a snippet (up to 100 chars) for context
            const snippet = line.trim().substring(0, 100);
            if (snippet.length > 0) {
              candidateSnippets.set(candidate, snippet);
            }
            break;
          }
        }
      }
    }
  }

  // Track provenance: determine input scope and region usage
  const hasRegion = !!ocrConfig;
  const inputScope: InputScope = croppedOcrText ? "CROPPED_REGION" : "FULL_TEXT";
  const reasons: ExtractionReason[] = [];
  
  if (hasRegion) {
    reasons.push("FM_REGION_FOUND");
  } else {
    reasons.push("FM_REGION_NOT_FOUND");
  }

  // Helper to build provenance
  const buildProvenance = (
    woNumberMethod: WoNumberMethod,
    pipelinePath: ExtractionPipelinePath,
    additionalReasons: ExtractionReason[] = []
  ) => {
    const croppedSnippet = croppedOcrText ? croppedOcrText.substring(0, 200) : null;
    const croppedHash = croppedOcrText 
      ? createHash("sha256").update(croppedOcrText).digest("hex").substring(0, 16)
      : null;

    return {
      woNumberMethod,
      regionUsed: hasRegion,
      regionKey: fmKey || null,
      pipelinePath,
      reasons: [...reasons, ...additionalReasons],
      inputScope,
      croppedTextSnippet: croppedSnippet,
      croppedTextHash: croppedHash,
    };
  };

  // Determine confidence for digital extraction
  if (digitalCandidates.length === 1) {
    // Single strong match
    const candidate = digitalCandidates[0];
    // Extract digits only for the work order number
    const digitsOnly = candidate.replace(/\D/g, "");
    if (digitsOnly.length === expectedDigits) {
      const woNumberMethod: WoNumberMethod = croppedOcrText 
        ? "CROPPED_OCR" 
        : "FULL_TEXT_REGEX";
      const pipelinePath: ExtractionPipelinePath = "DIGITAL_ONLY";
      
      return {
        workOrderNumber: digitsOnly,
        method: "DIGITAL_TEXT",
        confidence: 0.98,
        rationale: croppedOcrText 
          ? "Found single work order number in cropped OCR region" 
          : "Found single work order number in full PDF text",
        candidates: [
          {
            value: digitsOnly,
            score: 0.98,
            source: "DIGITAL_TEXT",
            sourceSnippet: candidateSnippets.get(candidate) || undefined,
          },
        ],
        debug: {
          digitalTextLength: finalText.length,
          candidateCount: digitalCandidates.length,
        },
        provenance: buildProvenance(woNumberMethod, pipelinePath),
      };
    }
  }

  if (digitalCandidates.length > 1) {
    // Multiple candidates - lower confidence
    const bestCandidate = digitalCandidates[0];
    const digitsOnly = bestCandidate.replace(/\D/g, "");
    if (digitsOnly.length === expectedDigits) {
      const woNumberMethod: WoNumberMethod = croppedOcrText 
        ? "CROPPED_OCR" 
        : "FULL_TEXT_REGEX";
      const pipelinePath: ExtractionPipelinePath = "DIGITAL_ONLY";
      
      return {
        workOrderNumber: digitsOnly,
        method: "DIGITAL_TEXT",
        confidence: 0.85,
        rationale: `Found ${digitalCandidates.length} candidates in ${croppedOcrText ? "cropped region" : "full PDF text"}; using best match`,
        candidates: digitalCandidates.slice(0, 5).map((c) => ({
          value: c.replace(/\D/g, ""),
          score: 0.85 - digitalCandidates.indexOf(c) * 0.1,
          source: "DIGITAL_TEXT" as ExtractMethod,
        })),
        debug: {
          digitalTextLength: finalText.length,
          candidateCount: digitalCandidates.length,
        },
        provenance: buildProvenance(woNumberMethod, pipelinePath, ["MULTIPLE_CANDIDATES"]),
      };
    }
  }

  // Digital extraction didn't yield high confidence result
  // Continue to OCR if available

  // ============================================
  // Layer B: OCR Pass (Fallback - only if not already run in Layer A)
  // ============================================
  // Note: If we already ran OCR in Layer A (to get cropped text), we skip this layer
  // to avoid duplicate OCR calls. The OCR result from Layer A is used for AI in Layer C.
  if (ocrConfig && pdfBuffer && !croppedOcrText) {
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
          const woNumberMethod: WoNumberMethod = "CROPPED_OCR";
          const pipelinePath: ExtractionPipelinePath = "OCR_ONLY";
          
          return {
            workOrderNumber: digitsOnly,
            method: "OCR",
            confidence: Math.min(ocrResult.confidenceRaw, 0.94),
            rationale: `OCR extracted work order number from cropped region with ${Math.round(ocrResult.confidenceRaw * 100)}% confidence`,
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
            provenance: buildProvenance(woNumberMethod, pipelinePath),
          };
        }
      }

      // Store OCR text for AI layer (if not already stored)
      if (ocrResult.rawText && ocrResult.rawText.trim().length > 0) {
        croppedOcrText = ocrResult.rawText;
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
  // IMPORTANT: AI should ONLY use cropped OCR text (from FM coordinates), not full PDF text
  // This prevents hallucination and extracting PO boxes, addresses, phone numbers, etc.
  if (aiEnabled && openaiKey && isAiParsingEnabled(aiEnabled, openaiKey)) {
    try {
      const profile = getIndustryProfile();
      const model = getAiModelName();

      // CRITICAL: Only use cropped OCR text (from FM coordinates), not full PDF text
      // This ensures AI only looks at the work order number area, not the entire document
      const textForAI = croppedOcrText || null;
      
      if (!textForAI) {
        console.log("[Extract WO] Skipping AI rescue - no cropped OCR text available (AI should only use cropped region)");
      } else {
        console.log("[Extract WO] Using cropped OCR text for AI extraction (from FM coordinates):", {
          textLength: textForAI.length,
          preview: textForAI.substring(0, 200),
        });

        const prompt = `You are a Work Order Number Extraction Engine for ${profile.label}.

Extract ONLY the work order number from the following text. This text is from a CROPPED REGION of the document (defined by FM profile coordinates), so it should contain ONLY the work order number area.

The work order number is typically ${expectedDigits} digits long, but may be ${expectedDigits - 1} to ${expectedDigits + 1} digits.

IMPORTANT:
- This text is from a CROPPED REGION, not the full document
- Extract ONLY the work order number (digits only)
- Ignore PO boxes, addresses, phone numbers, dates, or any other numbers
- If you see multiple numbers, choose the one that matches the expected digit count (${expectedDigits} digits)

Cropped Text (from FM coordinates):
${textForAI.substring(0, 2000)}

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
                "You are a highly accurate Work Order Number Extraction Engine. You ONLY extract work order numbers from cropped document regions. Always respond with valid JSON only, no explanations.",
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
            const rationale = parsed.rationale || "AI extracted work order number from cropped region";

            if (woNumber && typeof woNumber === "string") {
              const digitsOnly = woNumber.replace(/\D/g, "");
              if (digitsOnly.length >= expectedDigits - 1 && digitsOnly.length <= expectedDigits + 1) {
                const woNumberMethod: WoNumberMethod = "CROPPED_OCR_PLUS_AI";
                const pipelinePath: ExtractionPipelinePath = croppedOcrText 
                  ? "DIGITAL_OCR_AI" 
                  : "AI_FALLBACK";
                
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
                    usedCroppedText: true,
                  },
                  provenance: buildProvenance(woNumberMethod, pipelinePath),
                };
              }
            }
          } catch (parseError) {
            console.log("[Extract WO] Failed to parse AI response:", parseError);
          }
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

  // Determine final provenance
  const woNumberMethod: WoNumberMethod = bestCandidate 
    ? (croppedOcrText ? "CROPPED_OCR" : "FULL_TEXT_REGEX")
    : "UNKNOWN";
  const pipelinePath: ExtractionPipelinePath = digitalCandidates.length > 0
    ? "DIGITAL_ONLY"
    : "UNKNOWN";
  
  const finalReasons: ExtractionReason[] = [];
  if (!bestCandidate) {
    finalReasons.push("NO_CANDIDATES");
  } else {
    finalReasons.push("LOW_CONFIDENCE");
    if (digitalCandidates.length > 1) {
      finalReasons.push("MULTIPLE_CANDIDATES");
    }
  }
  if (!croppedOcrText && !hasRegion && aiEnabled) {
    finalReasons.push("AI_SKIPPED_NO_REGION");
  }

  return {
    workOrderNumber: bestCandidate && bestCandidate.length >= expectedDigits - 1 ? bestCandidate : null,
    method: digitalCandidates.length > 0 ? "DIGITAL_TEXT" : "OCR",
    confidence: bestCandidate ? 0.70 : 0.0,
    rationale: bestCandidate
      ? `Found candidate but confidence too low for automatic processing (${croppedOcrText ? "from cropped region" : "from full PDF text"})`
      : "No clear work order number found; low scan quality or missing text",
    candidates: digitalCandidates.slice(0, 3).map((c) => ({
      value: c.replace(/\D/g, ""),
      score: 0.70 - digitalCandidates.indexOf(c) * 0.1,
      source: "DIGITAL_TEXT" as ExtractMethod,
    })),
    debug: {
      digitalTextLength: finalText.length,
      candidateCount: digitalCandidates.length,
      hasOcrConfig: !!ocrConfig,
      aiEnabled: !!aiEnabled,
    },
    provenance: buildProvenance(woNumberMethod, pipelinePath, finalReasons),
  };
}
