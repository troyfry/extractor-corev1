/**
 * Types for the 3-layer work order number extraction flow.
 * 
 * Flow: Digital Text → OCR → AI Rescue
 */

import type { WoNumberMethod, ExtractionPipelinePath, InputScope, ExtractionReason } from "./fieldAuthorityPolicy";

export type ExtractMethod = "DIGITAL_TEXT" | "OCR" | "AI_RESCUE";

export type ExtractionCandidate = {
  value: string;
  score: number; // 0..1
  source: ExtractMethod;
  // Optional: line snippet where candidate was found (for context)
  sourceSnippet?: string;
};

export type ExtractionResult = {
  workOrderNumber: string | null;
  method: ExtractMethod;
  confidence: number; // 0..1
  rationale?: string; // short human readable explanation
  candidates?: ExtractionCandidate[];
  debug?: Record<string, unknown>;
  // Provenance fields (DB-first ready) - tracks how extraction was performed
  provenance?: {
    woNumberMethod: WoNumberMethod;
    regionUsed: boolean;
    regionKey: string | null;
    pipelinePath: ExtractionPipelinePath;
    reasons: ExtractionReason[];
    inputScope: InputScope;
    croppedTextSnippet?: string | null;
    croppedTextHash?: string | null;
  };
};
