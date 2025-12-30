/**
 * Signed Work Order Trust Decision Engine
 * 
 * This module provides a deterministic decision engine that evaluates extracted
 * work order candidates and signals to determine the appropriate trust level and
 * processing state.
 * 
 * The engine takes extraction candidates, confidence signals, and template rules,
 * then returns one of three states:
 * - AUTO_CONFIRMED: High confidence, can be automatically processed
 * - QUICK_CHECK: Medium confidence, requires quick human verification
 * - NEEDS_ATTENTION: Low confidence or issues, requires manual review
 * 
 * Usage:
 * ```typescript
 * const result = decideSignedWorkOrder({
 *   rawText: "WO 1234567",
 *   templateRule: { expectedDigits: 7 },
 *   signals: {
 *     extractionMethod: "DIGITAL_TEXT",
 *     confidenceRaw: 0.95,
 *     passAgreement: true
 *   }
 * });
 * 
 * if (result.state === "AUTO_CONFIRMED") {
 *   // Process automatically
 * } else if (result.state === "QUICK_CHECK") {
 *   // Show for quick verification
 * } else {
 *   // Require manual review
 * }
 * ```
 */

export type DecisionState = "AUTO_CONFIRMED" | "QUICK_CHECK" | "NEEDS_ATTENTION";

export type ExtractionMethod = "DIGITAL_TEXT" | "OCR";

export type ReasonCode =
  | "NO_CANDIDATE"
  | "MULTIPLE_CANDIDATES"
  | "FORMAT_MISMATCH"
  | "LOW_CONFIDENCE"
  | "PASS_AGREEMENT"
  | "SEQ_OUTLIER"
  | "OK_FORMAT"
  | "DIGITAL_TEXT_STRONG";

export interface TemplateRule {
  /** Expected number of digits in the work order number (e.g. 7) */
  expectedDigits: number;
  /** 
   * If true, allow prefixes like "WO" or "WO#" in raw text extraction.
   * Currently candidates are always normalized to digits-only; allowPrefix/digitsOnly 
   * reserved for future template tuning.
   */
  allowPrefix?: boolean;
  /** 
   * If true, normalize to digits-only (default behavior).
   * Currently candidates are always normalized to digits-only; allowPrefix/digitsOnly 
   * reserved for future template tuning.
   */
  digitsOnly?: boolean;
  /** Optional stricter regex pattern for validation */
  regex?: RegExp;
}

export interface DecisionSignals {
  /** How the work order number was extracted */
  extractionMethod: ExtractionMethod;
  /** OCR confidence score (0..1), only for OCR method */
  confidenceRaw?: number;
  /** Whether OCR pass1 and pass2 agreed on the digits (OCR only) */
  passAgreement?: boolean;
  /** Last known work order number (digits-only) for sequence validation */
  lastKnownWo?: string;
}

export interface DecisionInput {
  /** Raw text to extract candidates from (optional if candidates provided) */
  rawText?: string;
  /** Pre-extracted candidate strings (optional if rawText provided) */
  candidates?: string[];
  /** Template rule defining expected format */
  templateRule: TemplateRule;
  /** Signals about extraction quality and context */
  signals: DecisionSignals;
}

export interface DecisionResult {
  /** The determined decision state */
  state: DecisionState;
  /** Best candidate (digits-only, normalized) */
  bestCandidate?: string;
  /** All normalized candidates (digits-only, unique, in encounter order) */
  normalizedCandidates: string[];
  /** Trust score (0..100) */
  trustScore: number;
  /** List of reason codes explaining the decision */
  reasons: ReasonCode[];
}

/**
 * Normalizes a candidate string to digits-only.
 * Strips spaces, prefixes (WO/WO#), and punctuation.
 * 
 * @param str - Input string (e.g. "WO 1234567", "WO#1234567", "123-4567")
 * @returns Digits-only string (e.g. "1234567")
 */
export function normalizeCandidate(str: string): string {
  // Remove common prefixes
  let normalized = str.trim();
  normalized = normalized.replace(/^WO\s*#?\s*/i, "");
  normalized = normalized.replace(/^work\s*order\s*#?\s*/i, "");
  
  // Extract all digits
  const digits = normalized.match(/\d/g);
  return digits ? digits.join("") : "";
}

/**
 * Extracts likely work order number candidates from raw text.
 * Looks for patterns like "WO 1234567", "WO#1234567", or standalone digit sequences.
 * Only returns sequences near the expected length (+/- 1 digit).
 * 
 * @param text - Raw text to search
 * @param expectedDigits - Expected number of digits
 * @returns Array of candidate strings (may include prefixes)
 */
export function extractCandidatesFromText(
  text: string,
  expectedDigits: number
): string[] {
  if (!text || typeof text !== "string") {
    return [];
  }

  const candidates: string[] = [];
  const minLength = expectedDigits - 1;
  const maxLength = expectedDigits + 1;

  // Pattern 1: "WO 1234567" or "WO#1234567" or "WO-1234567"
  const woPattern = /\bWO\s*#?\s*-?\s*(\d{4,})\b/gi;
  let match;
  while ((match = woPattern.exec(text)) !== null) {
    const digits = match[1];
    if (digits.length >= minLength && digits.length <= maxLength) {
      candidates.push(match[0]); // Keep prefix for context
    }
  }

  // Pattern 2: Standalone digit sequences of expected length
  const digitPattern = /\b(\d{4,})\b/g;
  // Reset regex lastIndex (digitPattern, not woPattern)
  digitPattern.lastIndex = 0;
  while ((match = digitPattern.exec(text)) !== null) {
    const digits = match[1];
    if (digits.length >= minLength && digits.length <= maxLength) {
      // Avoid duplicates from pattern 1
      if (!candidates.some(c => c.includes(digits))) {
        candidates.push(digits);
      }
    }
  }

  return candidates;
}

/**
 * Validates a candidate against the template rule.
 * 
 * @param candidate - Normalized digits-only candidate
 * @param rule - Template rule to validate against
 * @returns true if candidate matches the rule
 */
export function validateFormat(candidate: string, rule: TemplateRule): boolean {
  // Check length
  if (candidate.length !== rule.expectedDigits) {
    return false;
  }

  // Check regex if provided
  if (rule.regex) {
    return rule.regex.test(candidate);
  }

  return true;
}

/**
 * Deduplicates an array while preserving encounter order (first occurrence wins).
 * 
 * @param items - Array of strings to dedupe
 * @returns Deduplicated array in encounter order
 */
function dedupeStable(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

/**
 * Calculates trust score and reasons for a single candidate based on signals.
 * This is the single source of truth for trust scoring logic.
 * 
 * @param bestCandidate - The candidate to score (digits-only, normalized)
 * @param signals - Decision signals (extraction method, confidence, etc.)
 * @returns Object with trustScore (0-100) and reasons array
 */
function scoreCandidate(
  bestCandidate: string,
  signals: DecisionSignals
): { trustScore: number; reasons: ReasonCode[] } {
  let trustScore = 60;
  const reasons: ReasonCode[] = ["OK_FORMAT"];

  // Digital text extraction is more reliable
  if (signals.extractionMethod === "DIGITAL_TEXT") {
    trustScore += 25;
    reasons.push("DIGITAL_TEXT_STRONG");
  }

  // Pass agreement indicates consistency
  if (signals.passAgreement === true) {
    trustScore += 20;
    reasons.push("PASS_AGREEMENT");
  }

  // Confidence score adjustments (OCR only)
  if (signals.confidenceRaw !== undefined) {
    if (signals.confidenceRaw >= 0.9) {
      trustScore += 15;
    } else if (signals.confidenceRaw >= 0.6) {
      trustScore += 5;
    } else {
      // Low confidence (< 0.6)
      // If passAgreement is true, don't penalize - agreement beats confidence
      if (signals.passAgreement) {
        // do NOT penalize; agreement beats confidence
      } else {
        trustScore -= 15;
        reasons.push("LOW_CONFIDENCE");
      }
    }
  }

  // Bonus: Agreement beats low confidence
  // If two OCR passes agree, even with low confidence, give a small boost
  // This pushes borderline cases (60 + 20 = 80) into AUTO_CONFIRMED
  if (signals.passAgreement === true && signals.confidenceRaw !== undefined && signals.confidenceRaw < 0.6) {
    trustScore += 5;
  }

  // Sequence validation (if last known WO exists)
  if (signals.lastKnownWo) {
    const lastWoNum = parseInt(signals.lastKnownWo, 10);
    const candidateNum = parseInt(bestCandidate, 10);

    if (!isNaN(lastWoNum) && !isNaN(candidateNum)) {
      const diff = candidateNum - lastWoNum;
      
      if (diff < 0) {
        // Candidate is before last known - outlier
        trustScore -= 10;
        reasons.push("SEQ_OUTLIER");
      } else if (diff <= 5000) {
        // Valid sequence - within reasonable range
        trustScore += 5;
      } else {
        // Huge forward jump (diff > 5000) - penalize to avoid auto-confirming wrong numbers
        // This prevents picking junk numbers like 9999999 when only ">= lastKnown" candidates exist
        trustScore -= 10;
        reasons.push("SEQ_OUTLIER");
      }
    }
  }

  // Clamp trust score to 0..100
  trustScore = Math.max(0, Math.min(100, trustScore));

  return { trustScore, reasons };
}

/**
 * Main decision function that evaluates candidates and signals to determine
 * the appropriate trust level and processing state.
 * 
 * This function is deterministic: same inputs always produce same outputs.
 * 
 * ## Trust Score Calculation (0-100)
 * 
 * The trust score starts at a base of 60 points when there is exactly one valid candidate
 * (i.e., a candidate that passes format validation). Points are then added or subtracted based on signals:
 * 
 * **Base Score:** 60 points
 * 
 * **Positive Adjustments:**
 * - DIGITAL_TEXT extraction: +25 points (digital text is more reliable than OCR)
 * - Pass agreement (OCR pass1==pass2): +20 points (indicates consistency)
 * - High confidence (>=0.9): +15 points
 * - Medium confidence (0.6-0.89): +5 points
 * - Valid sequence (within 5000 of lastKnownWo): +5 points
 * 
 * **Negative Adjustments:**
 * - Low confidence (<0.6): -15 points (unless passAgreement is true, in which case no penalty)
 * - Sequence outlier (before lastKnownWo): -10 points
 * 
 * **State Determination:**
 * - AUTO_CONFIRMED: trustScore >= 80 (high confidence, can process automatically)
 * - QUICK_CHECK: trustScore 60-79 (medium confidence, needs quick verification)
 * - NEEDS_ATTENTION: trustScore < 60 or issues (low confidence or problems)
 * 
 * **Important:** These thresholds (60, 80) define the meaning of QUICK_CHECK vs AUTO_CONFIRMED.
 * Changing the base score or thresholds will change the behavior of the decision engine.
 * 
 * @param input - Decision input with candidates, signals, and template rule
 * @returns Decision result with state, trust score, and reasons
 */
export function decideSignedWorkOrder(input: DecisionInput): DecisionResult {
  const { rawText, candidates, templateRule, signals } = input;

  // Step 1: Build normalized candidates list
  let normalizedCandidates: string[] = [];

  if (candidates && candidates.length > 0) {
    // Use provided candidates
    normalizedCandidates = candidates
      .map(normalizeCandidate)
      .filter(c => c.length > 0);
  } else if (rawText) {
    // Extract from raw text
    const extracted = extractCandidatesFromText(rawText, templateRule.expectedDigits);
    normalizedCandidates = extracted
      .map(normalizeCandidate)
      .filter(c => c.length > 0);
  }

  // Dedupe while preserving encounter order
  normalizedCandidates = dedupeStable(normalizedCandidates);

  // Step 2: Early exit if no candidates
  if (normalizedCandidates.length === 0) {
    return {
      state: "NEEDS_ATTENTION",
      normalizedCandidates: [],
      trustScore: 0,
      reasons: ["NO_CANDIDATE"],
    };
  }

  // Step 3: Filter to valid format candidates
  const validCandidates = normalizedCandidates.filter(c =>
    validateFormat(c, templateRule)
  );

  // Step 4: Handle multiple candidates
  if (validCandidates.length > 1) {
    // Try auto-resolution if lastKnownWo exists
    let bestCandidate = validCandidates[0];
    
    if (signals.lastKnownWo) {
      const lastWoNum = parseInt(signals.lastKnownWo, 10);
      if (!isNaN(lastWoNum)) {
        // Find the valid candidate that is >= lastKnownWo with smallest positive diff
        const candidatesAfterLast = validCandidates
          .map(c => ({ candidate: c, num: parseInt(c, 10) }))
          .filter(({ num }) => !isNaN(num) && num >= lastWoNum)
          .sort((a, b) => a.num - b.num); // Sort by numeric value ascending
        
        if (candidatesAfterLast.length > 0) {
          // Use the closest candidate after lastKnownWo
          bestCandidate = candidatesAfterLast[0].candidate;
          
          // Calculate trust score using shared scoring logic
          // This turns many "two numbers on the page" PDFs into AUTO/QUICK safely
          const { trustScore, reasons } = scoreCandidate(bestCandidate, signals);
          
          // Only auto-resolve if it results in AUTO_CONFIRMED or QUICK_CHECK
          // (don't auto-resolve to NEEDS_ATTENTION)
          if (trustScore >= 60) {
            const state: DecisionState = trustScore >= 80 ? "AUTO_CONFIRMED" : "QUICK_CHECK";
            return {
              state,
              bestCandidate,
              normalizedCandidates, // Keep all candidates for visibility
              trustScore,
              reasons,
            };
          }
          // Otherwise fall through to multiple candidates handling
        }
      }
    }
    
    // Multiple candidates, cannot auto-resolve (or auto-resolution didn't meet threshold)
    return {
      state: "NEEDS_ATTENTION",
      bestCandidate: validCandidates[0],
      normalizedCandidates,
      trustScore: Math.min(30, 100 - validCandidates.length * 10),
      reasons: ["MULTIPLE_CANDIDATES"],
    };
  }

  // Step 5: Handle format mismatch
  if (validCandidates.length === 0 && normalizedCandidates.length > 0) {
    return {
      state: "NEEDS_ATTENTION",
      bestCandidate: normalizedCandidates[0],
      normalizedCandidates,
      trustScore: 20,
      reasons: ["FORMAT_MISMATCH"],
    };
  }

  // Step 6: Exactly one valid candidate - calculate trust score
  const bestCandidate = validCandidates[0];
  const { trustScore, reasons } = scoreCandidate(bestCandidate, signals);

  // Determine state based on trust score
  let state: DecisionState;
  if (trustScore >= 80) {
    state = "AUTO_CONFIRMED";
  } else if (trustScore >= 60) {
    state = "QUICK_CHECK";
  } else {
    state = "NEEDS_ATTENTION";
  }

  return {
    state,
    bestCandidate,
    normalizedCandidates,
    trustScore,
    reasons,
  };
}

