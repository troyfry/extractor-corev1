/**
 * Page Dimension Validation Tests
 * 
 * Tests for validating PDF page dimensions to ensure only standard page sizes
 * (Letter, A4, Legal, Tabloid) are allowed for template capture.
 * 
 * Why this matters: Phone photo scans and unusual PDFs have non-standard dimensions
 * that should be rejected. Only standard digital work order PDFs should be used
 * for template capture.
 */

import { describe, it, expect } from "vitest";
import { validatePageDimensions, STANDARD_PAGE_SIZES } from "@/lib/templates/pageDimensions";

describe("Page Dimension Validation", () => {
  describe("Standard page sizes (portrait)", () => {
    it("should accept Letter size (612 x 792)", () => {
      const result = validatePageDimensions(612, 792);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Letter");
    });

    it("should accept Letter size with tolerance (607 x 797)", () => {
      // Within 5 point tolerance
      const result = validatePageDimensions(607, 797);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Letter");
    });

    it("should accept A4 size (595.276 x 841.890)", () => {
      const result = validatePageDimensions(595.276, 841.890);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("A4");
    });

    it("should accept A4 size with tolerance (590.276 x 836.890)", () => {
      // Within 5 point tolerance
      const result = validatePageDimensions(590.276, 836.890);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("A4");
    });

    it("should accept Legal size (612 x 1008)", () => {
      const result = validatePageDimensions(612, 1008);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Legal");
    });

    it("should accept Tabloid size (792 x 1224)", () => {
      const result = validatePageDimensions(792, 1224);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Tabloid");
    });
  });

  describe("Standard page sizes (landscape)", () => {
    it("should accept Letter landscape (792 x 612)", () => {
      const result = validatePageDimensions(792, 612);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Letter (landscape)");
    });

    it("should accept A4 landscape (841.890 x 595.276)", () => {
      const result = validatePageDimensions(841.890, 595.276);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("A4 (landscape)");
    });

    it("should accept Legal landscape (1008 x 612)", () => {
      const result = validatePageDimensions(1008, 612);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Legal (landscape)");
    });

    it("should accept Tabloid landscape (1224 x 792)", () => {
      const result = validatePageDimensions(1224, 792);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Tabloid (landscape)");
    });
  });

  describe("Tolerance handling", () => {
    it("should accept dimensions at exact tolerance boundary (617 x 797 for Letter)", () => {
      // Letter: 612 x 792, tolerance: 5
      // 617 = 612 + 5 (exactly at boundary)
      // 797 = 792 + 5 (exactly at boundary)
      const result = validatePageDimensions(617, 797);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Letter");
    });

    it("should reject dimensions beyond tolerance (618 x 797 for Letter)", () => {
      // Letter: 612 x 792, tolerance: 5
      // 618 = 612 + 6 (beyond tolerance)
      const result = validatePageDimensions(618, 797);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should accept dimensions at negative tolerance boundary (607 x 787 for Letter)", () => {
      // Letter: 612 x 792, tolerance: 5
      // 607 = 612 - 5 (exactly at boundary)
      // 787 = 792 - 5 (exactly at boundary)
      const result = validatePageDimensions(607, 787);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("Letter");
    });

    it("should reject dimensions beyond negative tolerance (606 x 787 for Letter)", () => {
      // Letter: 612 x 792, tolerance: 5
      // 606 = 612 - 6 (beyond tolerance)
      const result = validatePageDimensions(606, 787);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });
  });

  describe("Non-standard page sizes (should be rejected)", () => {
    it("should reject phone photo scan dimensions (2000 x 3000)", () => {
      // Typical phone photo scan - very large, non-standard dimensions
      const result = validatePageDimensions(2000, 3000);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should reject square dimensions (1000 x 1000)", () => {
      // Square PDFs are not standard work order formats
      const result = validatePageDimensions(1000, 1000);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should reject very small dimensions (100 x 150)", () => {
      // Too small to be a standard page
      const result = validatePageDimensions(100, 150);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should reject unusual aspect ratio (500 x 2000)", () => {
      // Very tall, narrow PDF - not a standard format
      const result = validatePageDimensions(500, 2000);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should reject unusual aspect ratio (2000 x 500)", () => {
      // Very wide, short PDF - not a standard format
      const result = validatePageDimensions(2000, 500);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should reject dimensions close to Letter but outside tolerance (620 x 800)", () => {
      // Letter is 612 x 792, but 620 x 800 is outside 5-point tolerance
      const result = validatePageDimensions(620, 800);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should reject dimensions close to A4 but outside tolerance (600 x 850)", () => {
      // A4 is 595.276 x 841.890, but 600 x 850 is outside 5-point tolerance
      const result = validatePageDimensions(600, 850);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });
  });

  describe("Edge cases", () => {
    it("should handle zero dimensions", () => {
      const result = validatePageDimensions(0, 0);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should handle negative dimensions", () => {
      const result = validatePageDimensions(-100, -200);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should handle very large dimensions", () => {
      const result = validatePageDimensions(10000, 15000);
      expect(result.isStandard).toBe(false);
      expect(result.matchedSize).toBeUndefined();
    });

    it("should handle decimal precision correctly", () => {
      // A4 with exact decimals
      const result = validatePageDimensions(595.276, 841.890);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("A4");
    });

    it("should handle rounded decimals within tolerance", () => {
      // A4 rounded to 595.3 x 841.9 (within 5 point tolerance)
      const result = validatePageDimensions(595.3, 841.9);
      expect(result.isStandard).toBe(true);
      expect(result.matchedSize).toBe("A4");
    });
  });

  describe("STANDARD_PAGE_SIZES constant", () => {
    it("should export STANDARD_PAGE_SIZES array", () => {
      expect(Array.isArray(STANDARD_PAGE_SIZES)).toBe(true);
      expect(STANDARD_PAGE_SIZES.length).toBeGreaterThan(0);
    });

    it("should have all required properties for each standard size", () => {
      STANDARD_PAGE_SIZES.forEach(page => {
        expect(page).toHaveProperty("name");
        expect(page).toHaveProperty("width");
        expect(page).toHaveProperty("height");
        expect(page).toHaveProperty("tolerance");
        expect(typeof page.name).toBe("string");
        expect(typeof page.width).toBe("number");
        expect(typeof page.height).toBe("number");
        expect(typeof page.tolerance).toBe("number");
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
        expect(page.tolerance).toBeGreaterThanOrEqual(0);
      });
    });

    it("should include both portrait and landscape orientations", () => {
      const hasPortrait = STANDARD_PAGE_SIZES.some(p => !p.name.includes("landscape"));
      const hasLandscape = STANDARD_PAGE_SIZES.some(p => p.name.includes("landscape"));
      expect(hasPortrait).toBe(true);
      expect(hasLandscape).toBe(true);
    });

    it("should have landscape versions with swapped width/height", () => {
      const letterPortrait = STANDARD_PAGE_SIZES.find(p => p.name === "Letter");
      const letterLandscape = STANDARD_PAGE_SIZES.find(p => p.name === "Letter (landscape)");
      
      expect(letterPortrait).toBeDefined();
      expect(letterLandscape).toBeDefined();
      expect(letterLandscape?.width).toBe(letterPortrait?.height);
      expect(letterLandscape?.height).toBe(letterPortrait?.width);
    });
  });
});

