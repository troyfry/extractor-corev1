/**
 * Unit tests for signedDecisionEngine
 * 
 * Run with: npx tsx lib/workOrders/signedDecisionEngine.test.ts
 * Or compile first: npx tsc lib/workOrders/signedDecisionEngine.test.ts && node lib/workOrders/signedDecisionEngine.test.js
 */

import {
  decideSignedWorkOrder,
  normalizeCandidate,
  extractCandidatesFromText,
  validateFormat,
  type DecisionInput,
} from "./signedDecisionEngine";

// Simple assertion helper
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message}\n  Expected: ${expected}\n  Actual: ${actual}`
    );
  }
}

function assertIncludes<T>(arr: T[], item: T, message: string): void {
  if (!arr.includes(item)) {
    throw new Error(
      `Assertion failed: ${message}\n  Array: ${JSON.stringify(arr)}\n  Missing: ${item}`
    );
  }
}

// Test cases
function testNormalizeCandidate(): void {
  console.log("Testing normalizeCandidate...");
  
  assertEqual(normalizeCandidate("WO 1234567"), "1234567", "Should remove WO prefix");
  assertEqual(normalizeCandidate("WO#1234567"), "1234567", "Should remove WO# prefix");
  assertEqual(normalizeCandidate("123-4567"), "1234567", "Should remove hyphens");
  assertEqual(normalizeCandidate("1234567"), "1234567", "Should handle digits-only");
  assertEqual(normalizeCandidate("Work Order 1234567"), "1234567", "Should remove 'Work Order' prefix");
  
  console.log("✓ normalizeCandidate tests passed");
}

function testExtractCandidatesFromText(): void {
  console.log("Testing extractCandidatesFromText...");
  
  const text1 = "WO 1234567 is the work order number";
  const candidates1 = extractCandidatesFromText(text1, 7);
  assert(candidates1.length > 0, "Should find candidates");
  assert(candidates1.some(c => c.includes("1234567")), "Should find WO 1234567");
  
  const text2 = "The number is 1234567";
  const candidates2 = extractCandidatesFromText(text2, 7);
  assert(candidates2.length > 0, "Should find standalone digits");
  
  const text3 = "WO 12345"; // Too short
  const candidates3 = extractCandidatesFromText(text3, 7);
  assert(candidates3.length === 0, "Should reject candidates too short");
  
  console.log("✓ extractCandidatesFromText tests passed");
}

function testValidateFormat(): void {
  console.log("Testing validateFormat...");
  
  const rule1 = { expectedDigits: 7 };
  assert(validateFormat("1234567", rule1), "Should accept 7 digits");
  assert(!validateFormat("123456", rule1), "Should reject 6 digits");
  assert(!validateFormat("12345678", rule1), "Should reject 8 digits");
  
  const rule2 = { expectedDigits: 7, regex: /^1\d{6}$/ };
  assert(validateFormat("1234567", rule2), "Should accept matching regex");
  assert(!validateFormat("2234567", rule2), "Should reject non-matching regex");
  
  console.log("✓ validateFormat tests passed");
}

function testCaseA_DigitalTextAutoConfirmed(): void {
  console.log("Testing Case A: DIGITAL_TEXT with one valid candidate => AUTO_CONFIRMED");
  
  const input: DecisionInput = {
    candidates: ["1234567"],
    templateRule: { expectedDigits: 7 },
    signals: {
      extractionMethod: "DIGITAL_TEXT",
    },
  };
  
  const result = decideSignedWorkOrder(input);
  
  assertEqual(result.state, "AUTO_CONFIRMED", "Should be AUTO_CONFIRMED");
  assertEqual(result.bestCandidate, "1234567", "Should have correct candidate");
  assert(result.trustScore >= 80, "Trust score should be >= 80");
  assertIncludes(result.reasons, "DIGITAL_TEXT_STRONG", "Should include DIGITAL_TEXT_STRONG");
  assertIncludes(result.reasons, "OK_FORMAT", "Should include OK_FORMAT");
  
  console.log("✓ Case A passed");
}

function testCaseB_OcrPassAgreementAutoConfirmed(): void {
  console.log("Testing Case B: OCR passAgreement true (with sufficient signal) => AUTO_CONFIRMED");
  
  // To achieve AUTO_CONFIRMED with OCR + passAgreement, we need:
  // Base 60 + passAgreement 20 + confidence bonus
  // For >= 80, we need at least 0 more points
  // With low confidence (<0.6): 60 + 20 - 15 = 65 (QUICK_CHECK)
  // With medium confidence (0.6-0.89): 60 + 20 + 5 = 85 (AUTO_CONFIRMED)
  // With high confidence (>=0.9): 60 + 20 + 15 = 95 (AUTO_CONFIRMED)
  
  const testCases = [
    {
      name: "high confidence + passAgreement",
      input: {
        candidates: ["1234567"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.95, // High confidence
          passAgreement: true,
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        // 60 + 20 (passAgreement) + 15 (high confidence) = 95 >= 80
        assertEqual(result.state, "AUTO_CONFIRMED", "Should be AUTO_CONFIRMED with high confidence + passAgreement");
        assertIncludes(result.reasons, "PASS_AGREEMENT", "Should include PASS_AGREEMENT");
        assert(result.trustScore >= 80, "Trust score should be >= 80");
      },
    },
    {
      name: "medium confidence + passAgreement",
      input: {
        candidates: ["1234567"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.7, // Medium confidence
          passAgreement: true,
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        // 60 + 20 (passAgreement) + 5 (medium confidence) = 85 >= 80
        assertEqual(result.state, "AUTO_CONFIRMED", "Should be AUTO_CONFIRMED with medium confidence + passAgreement");
      },
    },
  ];

  for (const testCase of testCases) {
    const result = decideSignedWorkOrder(testCase.input);
    testCase.assertions(result);
  }
  
  console.log("✓ Case B passed");
}

function testCaseC_OcrMediumConfidenceQuickCheck(): void {
  console.log("Testing Case C: OCR medium confidence no passAgreement => QUICK_CHECK");
  
  const input: DecisionInput = {
    candidates: ["1234567"],
    templateRule: { expectedDigits: 7 },
    signals: {
      extractionMethod: "OCR",
      confidenceRaw: 0.7, // Medium confidence
      passAgreement: false,
    },
  };
  
  const result = decideSignedWorkOrder(input);
  
  // trustScore = 60 (base) + 5 (medium confidence) = 65
  assertEqual(result.state, "QUICK_CHECK", "Should be QUICK_CHECK");
  assert(result.trustScore >= 60 && result.trustScore < 80, "Trust score should be 60-79");
  assertIncludes(result.reasons, "OK_FORMAT", "Should include OK_FORMAT");
  
  console.log("✓ Case C passed");
}

function testCaseD_MultipleCandidates(): void {
  console.log("Testing Case D: Two candidates => NEEDS_ATTENTION with MULTIPLE_CANDIDATES");
  
  const input: DecisionInput = {
    candidates: ["1234567", "1234568"],
    templateRule: { expectedDigits: 7 },
    signals: {
      extractionMethod: "OCR",
      confidenceRaw: 0.9,
    },
  };
  
  const result = decideSignedWorkOrder(input);
  
  assertEqual(result.state, "NEEDS_ATTENTION", "Should be NEEDS_ATTENTION");
  assertIncludes(result.reasons, "MULTIPLE_CANDIDATES", "Should include MULTIPLE_CANDIDATES");
  assert(!result.reasons.includes("OK_FORMAT"), "Should not include OK_FORMAT with multiple candidates");
  assert(result.trustScore <= 30, "Trust score should be <= 30");
  assert(result.normalizedCandidates.length === 2, "Should have 2 candidates");
  
  console.log("✓ Case D passed");
}

function testCaseE_NoCandidates(): void {
  console.log("Testing Case E: No candidates => NEEDS_ATTENTION with NO_CANDIDATE");
  
  const input: DecisionInput = {
    rawText: "No work order number here",
    templateRule: { expectedDigits: 7 },
    signals: {
      extractionMethod: "OCR",
    },
  };
  
  const result = decideSignedWorkOrder(input);
  
  assertEqual(result.state, "NEEDS_ATTENTION", "Should be NEEDS_ATTENTION");
  assertIncludes(result.reasons, "NO_CANDIDATE", "Should include NO_CANDIDATE");
  assertEqual(result.trustScore, 0, "Trust score should be 0");
  assertEqual(result.normalizedCandidates.length, 0, "Should have no candidates");
  
  console.log("✓ Case E passed");
}

function testSequenceValidation(): void {
  console.log("Testing sequence validation...");
  
  const testCases = [
    {
      name: "Valid sequence (within range)",
      input: {
        candidates: ["1235000"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.8,
          lastKnownWo: "1230000", // 5000 difference, valid
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        assert(!result.reasons.includes("SEQ_OUTLIER"), "Should not be outlier");
      },
    },
    {
      name: "Outlier (before last known)",
      input: {
        candidates: ["1220000"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.8,
          lastKnownWo: "1230000",
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        assertIncludes(result.reasons, "SEQ_OUTLIER", "Should be outlier (before last known)");
      },
    },
    {
      name: "Huge forward jump (>5000)",
      input: {
        candidates: ["1240000"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.8,
          lastKnownWo: "1230000", // 10000 difference, too large
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        assertIncludes(result.reasons, "SEQ_OUTLIER", "Should be outlier (huge forward jump >5000)");
        // Trust score should be penalized (60 base + 5 medium confidence - 10 outlier = 55)
        assert(result.trustScore < 60, "Trust score should be penalized for huge forward jump");
      },
    },
  ];

  for (const testCase of testCases) {
    const result = decideSignedWorkOrder(testCase.input);
    testCase.assertions(result);
  }
  
  console.log("✓ Sequence validation tests passed");
}

function testCaseF_FormatMismatch(): void {
  console.log("Testing Case F: Format mismatch => NEEDS_ATTENTION with FORMAT_MISMATCH");
  
  const input: DecisionInput = {
    candidates: ["123456"], // Wrong length (6 instead of 7)
    templateRule: { expectedDigits: 7 },
    signals: {
      extractionMethod: "OCR",
      confidenceRaw: 0.9,
    },
  };
  
  const result = decideSignedWorkOrder(input);
  
  assertEqual(result.state, "NEEDS_ATTENTION", "Should be NEEDS_ATTENTION");
  assertIncludes(result.reasons, "FORMAT_MISMATCH", "Should include FORMAT_MISMATCH");
  assertEqual(result.bestCandidate, "123456", "Should have the candidate even if wrong format");
  assertEqual(result.trustScore, 20, "Trust score should be 20 for format mismatch");
  
  console.log("✓ Case F passed");
}

function testCaseG_RawTextEndToEnd(): void {
  console.log("Testing Case G: Extraction from rawText feeds decision end-to-end");
  
  const testCases = [
    {
      name: "DIGITAL_TEXT extraction from rawText",
      input: {
        rawText: "Please see WO#1234567",
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "DIGITAL_TEXT" as const,
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        // Should extract "1234567" from rawText and make a decision
        assertEqual(result.bestCandidate, "1234567", "Should extract candidate from rawText");
        assertEqual(result.state, "AUTO_CONFIRMED", "State should align with signals (DIGITAL_TEXT => AUTO_CONFIRMED)");
        assert(result.normalizedCandidates.length > 0, "Should have normalized candidates");
        assert(result.trustScore >= 0 && result.trustScore <= 100, "Should have valid trust score");
      },
    },
    {
      name: "OCR extraction from rawText",
      input: {
        rawText: "Work Order Number: WO 1234567",
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.8,
          passAgreement: true,
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        assertEqual(result.bestCandidate, "1234567", "Should extract from rawText with OCR signals");
        assert(result.state === "AUTO_CONFIRMED" || result.state === "QUICK_CHECK", "State should align with OCR signals");
      },
    },
  ];

  for (const testCase of testCases) {
    const result = decideSignedWorkOrder(testCase.input);
    testCase.assertions(result);
  }
  
  console.log("✓ Case G passed");
}

function testDedupeAndStableOrdering(): void {
  console.log("Testing dedupe and stable ordering...");
  
  const testCases = [
    {
      name: "Dedupe 2 variants to single candidate",
      input: {
        candidates: ["WO 1234567", "1234567"], // Both normalize to same
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "DIGITAL_TEXT" as const,
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        // Should not be MULTIPLE_CANDIDATES since they're all the same
        assert(!result.reasons.includes("MULTIPLE_CANDIDATES"), "Should not have MULTIPLE_CANDIDATES for duplicates");
        assertEqual(result.normalizedCandidates.length, 1, "Should dedupe to single candidate");
        assertEqual(result.normalizedCandidates[0], "1234567", "Should normalize correctly");
        assertEqual(result.state, "AUTO_CONFIRMED", "Should be AUTO_CONFIRMED (single valid candidate)");
      },
    },
    {
      name: "Dedupe 3 variants to single candidate",
      input: {
        candidates: ["WO 1234567", "1234567", "WO#1234567"], // All normalize to same
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "DIGITAL_TEXT" as const,
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        assertEqual(result.normalizedCandidates.length, 1, "Should dedupe 3 variants to single candidate");
      },
    },
    {
      name: "Preserve encounter order with different candidates",
      input: {
        candidates: ["1234568", "1234567", "1234569"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        // Should preserve encounter order (not sorted)
        assert(result.normalizedCandidates.length === 3, "Should have all 3 candidates");
        assertEqual(result.normalizedCandidates[0], "1234568", "Should preserve encounter order (first)");
        assertEqual(result.normalizedCandidates[1], "1234567", "Should preserve encounter order (second)");
        assertEqual(result.normalizedCandidates[2], "1234569", "Should preserve encounter order (third)");
        assertIncludes(result.reasons, "MULTIPLE_CANDIDATES", "Should have MULTIPLE_CANDIDATES for different candidates");
        assert(!result.reasons.includes("OK_FORMAT"), "Should not include OK_FORMAT with multiple candidates");
      },
    },
  ];

  for (const testCase of testCases) {
    const result = decideSignedWorkOrder(testCase.input);
    testCase.assertions(result);
  }
  
  console.log("✓ Dedupe and stable ordering tests passed");
}

function testAutoResolutionMultipleCandidates(): void {
  console.log("Testing auto-resolution for multiple candidates with lastKnownWo...");
  
  const testCases = [
    {
      name: "Auto-resolve when one candidate is after lastKnownWo",
      input: {
        candidates: ["1230000", "1235000"], // 1235000 is after lastKnownWo
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "DIGITAL_TEXT" as const,
          lastKnownWo: "1232000", // Between the two candidates
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        // Should auto-resolve to 1235000 (closest after lastKnownWo)
        assertEqual(result.bestCandidate, "1235000", "Should auto-resolve to candidate after lastKnownWo");
        assertEqual(result.state, "AUTO_CONFIRMED", "Should be AUTO_CONFIRMED (DIGITAL_TEXT + valid sequence)");
        assert(result.normalizedCandidates.length === 2, "Should still show all candidates for visibility");
        assert(!result.reasons.includes("MULTIPLE_CANDIDATES"), "Should not have MULTIPLE_CANDIDATES when auto-resolved");
      },
    },
    {
      name: "Do not auto-resolve when both candidates are before lastKnownWo",
      input: {
        candidates: ["1220000", "1225000"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.8,
          lastKnownWo: "1230000", // Both candidates are before this
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        assertEqual(result.state, "NEEDS_ATTENTION", "Should be NEEDS_ATTENTION when no candidates after lastKnownWo");
        assertIncludes(result.reasons, "MULTIPLE_CANDIDATES", "Should have MULTIPLE_CANDIDATES");
      },
    },
    {
      name: "Do not auto-resolve when result would be NEEDS_ATTENTION",
      input: {
        candidates: ["1230000", "1235000"],
        templateRule: { expectedDigits: 7 },
        signals: {
          extractionMethod: "OCR" as const,
          confidenceRaw: 0.3, // Very low confidence
          lastKnownWo: "1232000",
        },
      },
      assertions: (result: ReturnType<typeof decideSignedWorkOrder>) => {
        // Low confidence would result in trustScore < 60, so should not auto-resolve
        assertEqual(result.state, "NEEDS_ATTENTION", "Should not auto-resolve if result would be NEEDS_ATTENTION");
        assertIncludes(result.reasons, "MULTIPLE_CANDIDATES", "Should have MULTIPLE_CANDIDATES");
      },
    },
  ];

  for (const testCase of testCases) {
    const result = decideSignedWorkOrder(testCase.input);
    testCase.assertions(result);
  }
  
  console.log("✓ Auto-resolution tests passed");
}

// Run all tests
function runAllTests(): void {
  console.log("Running signedDecisionEngine tests...\n");
  
  try {
    testNormalizeCandidate();
    testExtractCandidatesFromText();
    testValidateFormat();
    testCaseA_DigitalTextAutoConfirmed();
    testCaseB_OcrPassAgreementAutoConfirmed();
    testCaseC_OcrMediumConfidenceQuickCheck();
    testCaseD_MultipleCandidates();
    testCaseE_NoCandidates();
    testCaseF_FormatMismatch();
    testCaseG_RawTextEndToEnd();
    testDedupeAndStableOrdering();
    testSequenceValidation();
    testAutoResolutionMultipleCandidates();
    
    console.log("\n✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Auto-run when executed directly (test file, not a library)
// This allows: npx tsx lib/workOrders/signedDecisionEngine.test.ts
if (process.argv[1]?.includes("signedDecisionEngine.test")) {
  runAllTests();
}

export { runAllTests };

