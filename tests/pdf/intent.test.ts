/**
 * PDF Intent Policy Tests
 * 
 * Tests for the centralized PDF intent policy resolution system.
 * Ensures consistent behavior across all PDF processing operations.
 */

import { describe, it, expect } from "vitest";
import {
  parsePdfIntent,
  resolvePdfIntentPolicy,
  PDF_INTENTS,
  type PdfIntent,
  type PdfIntentPolicy,
} from "@/lib/pdf/intent";

describe("PDF Intent Policy", () => {
  describe("parsePdfIntent", () => {
    it("should parse valid TEMPLATE_CAPTURE intent", () => {
      expect(parsePdfIntent("TEMPLATE_CAPTURE")).toBe("TEMPLATE_CAPTURE");
    });

    it("should parse valid SIGNED_PROCESSING intent", () => {
      expect(parsePdfIntent("SIGNED_PROCESSING")).toBe("SIGNED_PROCESSING");
    });

    it("should parse valid GENERAL_VIEW intent", () => {
      expect(parsePdfIntent("GENERAL_VIEW")).toBe("GENERAL_VIEW");
    });

    it("should return null for invalid intent string", () => {
      expect(parsePdfIntent("INVALID_INTENT")).toBeNull();
      expect(parsePdfIntent("template_capture")).toBeNull(); // case sensitive
      expect(parsePdfIntent("TEMPLATE_CAPTURE ")).toBeNull(); // whitespace
    });

    it("should return null for non-string values", () => {
      expect(parsePdfIntent(null)).toBeNull();
      expect(parsePdfIntent(undefined)).toBeNull();
      expect(parsePdfIntent(123)).toBeNull();
      expect(parsePdfIntent(true)).toBeNull();
      expect(parsePdfIntent({})).toBeNull();
      expect(parsePdfIntent([])).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(parsePdfIntent("")).toBeNull();
    });
  });

  describe("PDF_INTENTS constant", () => {
    it("should export all valid intents", () => {
      expect(PDF_INTENTS).toContain("TEMPLATE_CAPTURE");
      expect(PDF_INTENTS).toContain("SIGNED_PROCESSING");
      expect(PDF_INTENTS).toContain("GENERAL_VIEW");
      expect(PDF_INTENTS.length).toBe(3);
    });

    it("should be readonly array type", () => {
      // TypeScript ensures readonly, but runtime doesn't freeze it
      // Just verify it's an array with the expected structure
      expect(Array.isArray(PDF_INTENTS)).toBe(true);
      expect(PDF_INTENTS.length).toBe(3);
    });
  });

  describe("resolvePdfIntentPolicy - TEMPLATE_CAPTURE", () => {
    it("should resolve TEMPLATE_CAPTURE with default flags", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
      });

      expect(policy.intent).toBe("TEMPLATE_CAPTURE");
      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
      expect(policy.allowRaster).toBe(false);
      expect(policy.shouldBlockRaster).toBe(true);
      expect(policy.reason).toBe("template_capture");
    });

    it("should resolve TEMPLATE_CAPTURE with allowRaster=true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: "true",
      });

      expect(policy.intent).toBe("TEMPLATE_CAPTURE");
      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
      expect(policy.allowRaster).toBe(true);
      expect(policy.shouldBlockRaster).toBe(false);
      expect(policy.reason).toBe("template_capture");
    });

    it("should resolve TEMPLATE_CAPTURE with allowRaster boolean true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: true,
      });

      expect(policy.allowRaster).toBe(true);
      expect(policy.shouldBlockRaster).toBe(false);
    });

    it("should ignore skipNormalization for TEMPLATE_CAPTURE", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        skipNormalization: "false", // Should be ignored
      });

      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
    });

    it("should ignore legacyDefaultSkipNormalization for TEMPLATE_CAPTURE", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        legacyDefaultSkipNormalization: true, // Should be ignored
      });

      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
    });
  });

  describe("resolvePdfIntentPolicy - SIGNED_PROCESSING", () => {
    it("should resolve SIGNED_PROCESSING with default flags (normalize=true)", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
      });

      expect(policy.intent).toBe("SIGNED_PROCESSING");
      expect(policy.normalize).toBe(true);
      expect(policy.skipNormalization).toBe(false);
      expect(policy.allowRaster).toBe(true);
      expect(policy.shouldBlockRaster).toBe(false);
      expect(policy.reason).toBe("signed_processing");
    });

    it("should resolve SIGNED_PROCESSING with skipNormalization=true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        skipNormalization: "true",
      });

      expect(policy.intent).toBe("SIGNED_PROCESSING");
      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
      expect(policy.allowRaster).toBe(true);
      expect(policy.shouldBlockRaster).toBe(false);
    });

    it("should resolve SIGNED_PROCESSING with skipNormalization boolean true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        skipNormalization: true,
      });

      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
    });

    it("should always allow raster for SIGNED_PROCESSING", () => {
      const policy1 = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        allowRaster: "false", // Should be ignored
      });

      expect(policy1.allowRaster).toBe(true);
      expect(policy1.shouldBlockRaster).toBe(false);

      const policy2 = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        allowRaster: false, // Should be ignored
      });

      expect(policy2.allowRaster).toBe(true);
      expect(policy2.shouldBlockRaster).toBe(false);
    });
  });

  describe("resolvePdfIntentPolicy - GENERAL_VIEW", () => {
    it("should resolve GENERAL_VIEW with default flags (uses legacyDefaultSkipNormalization)", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "GENERAL_VIEW",
        legacyDefaultSkipNormalization: false,
      });

      expect(policy.intent).toBe("GENERAL_VIEW");
      expect(policy.normalize).toBe(true);
      expect(policy.skipNormalization).toBe(false);
      expect(policy.allowRaster).toBe(false);
      expect(policy.shouldBlockRaster).toBe(false);
      expect(policy.reason).toBe("general_view");
    });

    it("should resolve GENERAL_VIEW with legacyDefaultSkipNormalization=true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "GENERAL_VIEW",
        legacyDefaultSkipNormalization: true,
      });

      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
    });

    it("should resolve GENERAL_VIEW with explicit skipNormalization", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "GENERAL_VIEW",
        skipNormalization: "true",
        legacyDefaultSkipNormalization: false, // Should be overridden
      });

      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
    });

    it("should resolve GENERAL_VIEW with allowRaster=true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "GENERAL_VIEW",
        allowRaster: "true",
      });

      expect(policy.allowRaster).toBe(true);
      expect(policy.shouldBlockRaster).toBe(false);
    });
  });

  describe("resolvePdfIntentPolicy - Legacy mode (no intent)", () => {
    it("should resolve legacy mode with default skipNormalization=false", () => {
      const policy = resolvePdfIntentPolicy({
        intent: null,
        legacyDefaultSkipNormalization: false,
      });

      expect(policy.intent).toBeNull();
      expect(policy.normalize).toBe(true);
      expect(policy.skipNormalization).toBe(false);
      expect(policy.allowRaster).toBe(false);
      expect(policy.shouldBlockRaster).toBe(false);
      expect(policy.reason).toBe("legacy");
    });

    it("should resolve legacy mode with default skipNormalization=true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: null,
        legacyDefaultSkipNormalization: true,
      });

      expect(policy.intent).toBeNull();
      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
      expect(policy.reason).toBe("legacy");
    });

    it("should resolve legacy mode with explicit skipNormalization", () => {
      const policy = resolvePdfIntentPolicy({
        intent: null,
        skipNormalization: "true",
        legacyDefaultSkipNormalization: false, // Should be overridden
      });

      expect(policy.normalize).toBe(false);
      expect(policy.skipNormalization).toBe(true);
    });

    it("should resolve legacy mode with invalid intent string", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "INVALID_INTENT",
        legacyDefaultSkipNormalization: false,
      });

      expect(policy.intent).toBeNull();
      expect(policy.reason).toBe("legacy");
    });

    it("should resolve legacy mode with undefined intent", () => {
      const policy = resolvePdfIntentPolicy({
        intent: undefined,
        legacyDefaultSkipNormalization: false,
      });

      expect(policy.intent).toBeNull();
      expect(policy.reason).toBe("legacy");
    });
  });

  describe("resolvePdfIntentPolicy - Boolean flag parsing", () => {
    it("should parse allowRaster as string 'true'", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: "true",
      });
      expect(policy.allowRaster).toBe(true);
    });

    it("should parse allowRaster as string 'false'", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: "false",
      });
      expect(policy.allowRaster).toBe(false);
    });

    it("should parse allowRaster as boolean true", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: true,
      });
      expect(policy.allowRaster).toBe(true);
    });

    it("should parse allowRaster as boolean false", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: false,
      });
      expect(policy.allowRaster).toBe(false);
    });

    it("should treat undefined allowRaster as false", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: undefined,
      });
      expect(policy.allowRaster).toBe(false);
    });

    it("should parse skipNormalization as string 'true'", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        skipNormalization: "true",
      });
      expect(policy.skipNormalization).toBe(true);
      expect(policy.normalize).toBe(false);
    });

    it("should parse skipNormalization as string 'false'", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        skipNormalization: "false",
      });
      expect(policy.skipNormalization).toBe(false);
      expect(policy.normalize).toBe(true);
    });

    it("should parse skipNormalization as boolean", () => {
      const policy1 = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        skipNormalization: true,
      });
      expect(policy1.skipNormalization).toBe(true);

      const policy2 = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        skipNormalization: false,
      });
      expect(policy2.skipNormalization).toBe(false);
    });
  });

  describe("resolvePdfIntentPolicy - Edge cases", () => {
    it("should handle empty string intent as legacy", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "",
        legacyDefaultSkipNormalization: false,
      });

      expect(policy.intent).toBeNull();
      expect(policy.reason).toBe("legacy");
    });

    it("should handle case-sensitive intent matching", () => {
      const policy1 = resolvePdfIntentPolicy({
        intent: "template_capture", // lowercase
        legacyDefaultSkipNormalization: false,
      });
      expect(policy1.intent).toBeNull();
      expect(policy1.reason).toBe("legacy");

      const policy2 = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE", // correct case
      });
      expect(policy2.intent).toBe("TEMPLATE_CAPTURE");
    });

    it("should handle whitespace in intent string", () => {
      const policy = resolvePdfIntentPolicy({
        intent: " TEMPLATE_CAPTURE ", // with whitespace
        legacyDefaultSkipNormalization: false,
      });
      expect(policy.intent).toBeNull();
      expect(policy.reason).toBe("legacy");
    });

    it("should handle numeric allowRaster as false", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: 1 as unknown as string, // TypeScript would catch this, but runtime might pass it
      });
      expect(policy.allowRaster).toBe(false);
    });

    it("should handle numeric skipNormalization as false", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
        skipNormalization: 0 as unknown as string,
      });
      expect(policy.skipNormalization).toBe(false);
    });
  });

  describe("resolvePdfIntentPolicy - Policy structure", () => {
    it("should always return all required policy fields", () => {
      const policy = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
      });

      expect(policy).toHaveProperty("intent");
      expect(policy).toHaveProperty("normalize");
      expect(policy).toHaveProperty("skipNormalization");
      expect(policy).toHaveProperty("allowRaster");
      expect(policy).toHaveProperty("shouldBlockRaster");
      expect(policy).toHaveProperty("reason");
    });

    it("should have consistent normalize/skipNormalization relationship", () => {
      const testCases = [
        { intent: "TEMPLATE_CAPTURE" as const },
        { intent: "SIGNED_PROCESSING" as const },
        { intent: "SIGNED_PROCESSING" as const, skipNormalization: "true" },
        { intent: "GENERAL_VIEW" as const, legacyDefaultSkipNormalization: false },
        { intent: "GENERAL_VIEW" as const, legacyDefaultSkipNormalization: true },
        { intent: null, legacyDefaultSkipNormalization: false },
        { intent: null, legacyDefaultSkipNormalization: true },
      ];

      testCases.forEach(testCase => {
        const policy = resolvePdfIntentPolicy(testCase);
        expect(policy.normalize).toBe(!policy.skipNormalization);
      });
    });

    it("should have consistent shouldBlockRaster logic for TEMPLATE_CAPTURE", () => {
      const policy1 = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: false,
      });
      expect(policy1.shouldBlockRaster).toBe(true);

      const policy2 = resolvePdfIntentPolicy({
        intent: "TEMPLATE_CAPTURE",
        allowRaster: true,
      });
      expect(policy2.shouldBlockRaster).toBe(false);
    });

    it("should never block raster for SIGNED_PROCESSING or GENERAL_VIEW", () => {
      const policy1 = resolvePdfIntentPolicy({
        intent: "SIGNED_PROCESSING",
      });
      expect(policy1.shouldBlockRaster).toBe(false);

      const policy2 = resolvePdfIntentPolicy({
        intent: "GENERAL_VIEW",
      });
      expect(policy2.shouldBlockRaster).toBe(false);

      const policy3 = resolvePdfIntentPolicy({
        intent: null,
      });
      expect(policy3.shouldBlockRaster).toBe(false);
    });
  });
});

