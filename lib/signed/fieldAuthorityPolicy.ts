/**
 * Field Authority Policy
 * 
 * Defines extraction rules for critical fields, especially work_order_number.
 * This policy ensures trust and traceability for extracted data.
 * 
 * DB-First Ready: All fields are designed to be stored in database for audit trail.
 */

/**
 * Work Order Number Authority Policy
 * 
 * Critical Identity Field (Highest Priority)
 * 
 * Rules:
 * 1. If FM profile has wo_number_region (crop coordinates):
 *    - Extract ONLY from cropped region
 *    - AI may structure the cropped region text (optional)
 *    - If confidence < threshold → Needs Review
 * 
 * 2. If no region exists:
 *    - Allow full PDF text for deterministic regex-only
 *    - Do NOT run AI for WO number (prevents hallucination)
 *    - If ambiguous → Needs Review
 */
export const WO_NUMBER_AUTHORITY_POLICY = {
  /**
   * When FM profile has crop coordinates, use cropped region only
   */
  USE_CROPPED_REGION_WHEN_AVAILABLE: true,
  
  /**
   * When no crop region, allow full PDF text for regex extraction
   */
  ALLOW_FULL_TEXT_WHEN_NO_REGION: true,
  
  /**
   * When no crop region, skip AI to prevent hallucination
   */
  SKIP_AI_WHEN_NO_REGION: true,
  
  /**
   * Confidence threshold for automatic processing
   */
  CONFIDENCE_THRESHOLD: 0.80,
  
  /**
   * If confidence below threshold, route to Needs Review
   */
  ROUTE_TO_REVIEW_BELOW_THRESHOLD: true,
} as const;

/**
 * Work Order Number Extraction Method
 * 
 * Tracks how the work order number was extracted for provenance.
 */
export type WoNumberMethod = 
  | "CROPPED_OCR"              // Extracted from cropped OCR region (FM coordinates)
  | "CROPPED_OCR_PLUS_AI"      // Extracted from cropped region with AI structuring
  | "FULL_TEXT_REGEX"          // Extracted from full PDF text using regex (no region)
  | "MANUAL"                   // Manually entered by user
  | "UNKNOWN";                 // Unknown method (legacy data)

/**
 * Extraction Pipeline Path
 * 
 * Tracks which layers of the extraction pipeline were used.
 */
export type ExtractionPipelinePath = 
  | "DIGITAL_ONLY"             // Digital text extraction only
  | "OCR_ONLY"                 // OCR extraction only
  | "AI_FALLBACK"              // AI rescue after digital/OCR
  | "DIGITAL_OCR"              // Digital + OCR
  | "DIGITAL_OCR_AI"           // All three layers
  | "UNKNOWN";

/**
 * Input Scope
 * 
 * Tracks what portion of the document was used for extraction.
 */
export type InputScope = 
  | "CROPPED_REGION"           // Only cropped region (FM coordinates)
  | "FULL_TEXT"                // Entire PDF text
  | "UNKNOWN";

/**
 * Extraction Reason Codes
 * 
 * Tracks why extraction succeeded, failed, or was routed to review.
 */
export type ExtractionReason = 
  | "FM_REGION_FOUND"          // FM profile has crop coordinates
  | "FM_REGION_NOT_FOUND"      // No crop coordinates in FM profile
  | "AI_SKIPPED_NO_REGION"     // AI skipped because no cropped region available
  | "LOW_CONFIDENCE"           // Confidence below threshold
  | "MULTIPLE_CANDIDATES"      // Multiple work order numbers found
  | "NO_CANDIDATES"            // No work order numbers found
  | "DIGITAL_EXTRACTION_FAILED" // Digital text extraction failed
  | "OCR_EXTRACTION_FAILED"     // OCR extraction failed
  | "AI_EXTRACTION_FAILED"     // AI extraction failed
  | "MANUAL_OVERRIDE"          // Manual entry by user
  | "UNKNOWN";

/**
 * Work Order Number Provenance
 * 
 * Stores complete provenance for work order number extraction.
 * This is what gets stored in the database for audit trail.
 */
export interface WoNumberProvenance {
  /** The extracted work order number */
  workOrderNumber: string | null;
  
  /** Method used to extract the number */
  method: WoNumberMethod;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Whether FM crop region was used */
  regionUsed: boolean;
  
  /** Which FM template region was used (versioned) */
  regionKey: string | null;
  
  /** Pipeline path taken */
  pipelinePath: ExtractionPipelinePath;
  
  /** Reasons for the extraction result */
  reasons: ExtractionReason[];
  
  /** Input scope (cropped vs full text) */
  inputScope: InputScope;
  
  /** Optional: cropped text snippet (for debugging) */
  croppedTextSnippet?: string | null;
  
  /** Optional: hash of cropped text (for deduplication) */
  croppedTextHash?: string | null;
  
  /** Rationale for the extraction */
  rationale?: string | null;
}

/**
 * Field Authority Policy for Other Fields
 * 
 * Details (address, job type, notes, amount): Can use full text
 * because we want these fields from the whole document.
 * 
 * These are "content fields" with broader extraction allowed.
 */
export const DETAIL_FIELDS_POLICY = {
  /**
   * Detail fields can use full PDF text (not restricted to cropped region)
   */
  ALLOW_FULL_TEXT: true,
  
  /**
   * Detail fields can use AI extraction
   */
  ALLOW_AI: true,
  
  /**
   * Detail fields are less critical than WO number
   */
  PRIORITY: "MEDIUM" as const,
} as const;

/**
 * Determine if FM profile has work order number region configured
 * 
 * Supports both percentage-based (xPct, yPct, etc.) and point-based (xPt, yPt, etc.) formats
 */
export function hasWoNumberRegion(fmProfile: {
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  // Percentage-based (from FM_Profiles sheet)
  xPct?: number;
  yPct?: number;
  wPct?: number;
  hPct?: number;
}): boolean {
  // Check for point-based format (from template config)
  const hasPoints = !!(
    fmProfile.xPt !== undefined &&
    fmProfile.yPt !== undefined &&
    fmProfile.wPt !== undefined &&
    fmProfile.hPt !== undefined &&
    fmProfile.pageWidthPt !== undefined &&
    fmProfile.pageHeightPt !== undefined
  );
  
  // Check for percentage-based format (from FM_Profiles sheet)
  const hasPercentages = !!(
    fmProfile.xPct !== undefined &&
    fmProfile.yPct !== undefined &&
    fmProfile.wPct !== undefined &&
    fmProfile.hPct !== undefined
  );
  
  return hasPoints || hasPercentages;
}

/**
 * Calculate FM Profile Completeness Score
 * 
 * Returns a score (0-1) indicating how complete the FM profile is.
 * Higher scores = more trust, less "Needs Review"
 * 
 * Supports both percentage-based (xPct, yPct) and point-based (xPt, yPt) formats
 */
export function calculateFmProfileCompleteness(fmProfile: {
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  // Percentage-based (from FM_Profiles sheet)
  xPct?: number;
  yPct?: number;
  wPct?: number;
  hPct?: number;
  page?: number;
  senderDomains?: string;
}): {
  score: number;
  hasWoNumberRegion: boolean;
  hasPage: boolean;
  hasSenderDomains: boolean;
  completeness: "HIGH" | "MEDIUM" | "LOW";
} {
  const hasWoRegion = hasWoNumberRegion(fmProfile);
  const hasPage = fmProfile.page !== undefined && fmProfile.page > 0;
  const hasSenderDomains = !!fmProfile.senderDomains && fmProfile.senderDomains.trim().length > 0;
  
  // Weight: WO# region is most important (50%), page (30%), sender domains (20%)
  let score = 0;
  if (hasWoRegion) score += 0.5;
  if (hasPage) score += 0.3;
  if (hasSenderDomains) score += 0.2;
  
  let completeness: "HIGH" | "MEDIUM" | "LOW";
  if (score >= 0.8) completeness = "HIGH";
  else if (score >= 0.5) completeness = "MEDIUM";
  else completeness = "LOW";
  
  return {
    score,
    hasWoNumberRegion: hasWoRegion,
    hasPage,
    hasSenderDomains,
    completeness,
  };
}
