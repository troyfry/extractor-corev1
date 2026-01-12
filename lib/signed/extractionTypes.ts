/**
 * Types for the 3-layer work order number extraction flow.
 * 
 * Flow: Digital Text → OCR → AI Rescue
 */

export type ExtractMethod = "DIGITAL_TEXT" | "OCR" | "AI_RESCUE";

export type ExtractionCandidate = {
  value: string;
  score: number; // 0..1
  source: ExtractMethod;
};

export type ExtractionResult = {
  workOrderNumber: string | null;
  method: ExtractMethod;
  confidence: number; // 0..1
  rationale?: string; // short human readable explanation
  candidates?: ExtractionCandidate[];
  debug?: Record<string, unknown>;
};
