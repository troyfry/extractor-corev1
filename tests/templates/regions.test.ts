/**
 * Template Region Domain Layer Tests
 * 
 * Tests for template region validation, normalization, and coordinate system handling.
 * These tests ensure the domain layer correctly validates and normalizes template regions
 * before they are saved to storage.
 * 
 * Why this matters: Template regions must be validated and normalized to a canonical format
 * before saving. Invalid regions cause coordinate conversion errors and template corruption.
 */

import { describe, it, expect } from "vitest";
import {
  validateTemplateRegion,
  normalizeTemplateRegion,
  normalizeCoordSystem,
  isTemplateRegion,
  type TemplateRegion,
  type RawTemplateRegion,
} from "@/lib/templates";

describe("Template Region Validation", () => {
  const validRegion: RawTemplateRegion = {
    xPt: 72,
    yPt: 144,
    wPt: 216,
    hPt: 72,
    pageWidthPt: 612,
    pageHeightPt: 792,
  };

  it("should accept valid region with all required PDF points", () => {
    expect(() => validateTemplateRegion(validRegion)).not.toThrow();
  });

  it("should reject region with percentage fields", () => {
    const regionWithPct: RawTemplateRegion = {
      ...validRegion,
      xPct: 10,
    };

    expect(() => validateTemplateRegion(regionWithPct)).toThrow(
      "Percentage fields (xPct, yPct, wPct, hPct) are not allowed"
    );
  });

  it("should reject region missing xPt", () => {
    const { xPt, ...regionWithoutX } = validRegion;
    expect(() => validateTemplateRegion(regionWithoutX)).toThrow(
      "PDF_POINTS format required: xPt, yPt, wPt, hPt, pageWidthPt, and pageHeightPt are required"
    );
  });

  it("should reject region missing yPt", () => {
    const { yPt, ...regionWithoutY } = validRegion;
    expect(() => validateTemplateRegion(regionWithoutY)).toThrow(
      "PDF_POINTS format required"
    );
  });

  it("should reject region missing wPt", () => {
    const { wPt, ...regionWithoutW } = validRegion;
    expect(() => validateTemplateRegion(regionWithoutW)).toThrow(
      "PDF_POINTS format required"
    );
  });

  it("should reject region missing hPt", () => {
    const { hPt, ...regionWithoutH } = validRegion;
    expect(() => validateTemplateRegion(regionWithoutH)).toThrow(
      "PDF_POINTS format required"
    );
  });

  it("should reject region missing pageWidthPt", () => {
    const { pageWidthPt, ...regionWithoutPageW } = validRegion;
    expect(() => validateTemplateRegion(regionWithoutPageW)).toThrow(
      "PDF_POINTS format required"
    );
  });

  it("should reject region missing pageHeightPt", () => {
    const { pageHeightPt, ...regionWithoutPageH } = validRegion;
    expect(() => validateTemplateRegion(regionWithoutPageH)).toThrow(
      "PDF_POINTS format required"
    );
  });

  it("should reject non-numeric xPt", () => {
    expect(() => validateTemplateRegion({ ...validRegion, xPt: "72" as any })).toThrow(
      "All PDF point fields must be numbers"
    );
  });

  it("should reject non-finite values", () => {
    expect(() => validateTemplateRegion({ ...validRegion, xPt: Infinity })).toThrow(
      "All PDF point fields must be finite numbers"
    );
  });

  it("should reject NaN values", () => {
    expect(() => validateTemplateRegion({ ...validRegion, xPt: NaN })).toThrow(
      "All PDF point fields must be finite numbers"
    );
  });

  it("should reject negative page dimensions", () => {
    expect(() => validateTemplateRegion({ ...validRegion, pageWidthPt: -612 })).toThrow(
      "pageWidthPt and pageHeightPt must be positive"
    );
  });

  it("should reject zero page dimensions", () => {
    expect(() => validateTemplateRegion({ ...validRegion, pageWidthPt: 0 })).toThrow(
      "pageWidthPt and pageHeightPt must be positive"
    );
  });

  it("should reject negative or zero region dimensions", () => {
    expect(() => validateTemplateRegion({ ...validRegion, wPt: -216 })).toThrow(
      "wPt and hPt must be positive"
    );
    expect(() => validateTemplateRegion({ ...validRegion, wPt: 0 })).toThrow(
      "wPt and hPt must be positive"
    );
  });

  it("should reject region extending beyond page bounds (x + w > pageWidth)", () => {
    expect(() => validateTemplateRegion({ ...validRegion, xPt: 500, wPt: 200 })).toThrow(
      "Region out of bounds"
    );
  });

  it("should reject region extending beyond page bounds (y + h > pageHeight)", () => {
    expect(() => validateTemplateRegion({ ...validRegion, yPt: 750, hPt: 100 })).toThrow(
      "Region out of bounds"
    );
  });

  it("should reject negative xPt", () => {
    expect(() => validateTemplateRegion({ ...validRegion, xPt: -10 })).toThrow(
      "Region out of bounds"
    );
  });

  it("should reject negative yPt", () => {
    expect(() => validateTemplateRegion({ ...validRegion, yPt: -10 })).toThrow(
      "Region out of bounds"
    );
  });

  it("should accept region at page edge (x + w = pageWidth)", () => {
    const edgeRegion: RawTemplateRegion = {
      xPt: 396,
      yPt: 144,
      wPt: 216, // 396 + 216 = 612 (pageWidthPt)
      hPt: 72,
      pageWidthPt: 612,
      pageHeightPt: 792,
    };
    expect(() => validateTemplateRegion(edgeRegion)).not.toThrow();
  });

  it("should accept region at page edge (y + h = pageHeight)", () => {
    const edgeRegion: RawTemplateRegion = {
      xPt: 72,
      yPt: 720,
      wPt: 216,
      hPt: 72, // 720 + 72 = 792 (pageHeightPt)
      pageWidthPt: 612,
      pageHeightPt: 792,
    };
    expect(() => validateTemplateRegion(edgeRegion)).not.toThrow();
  });
});

describe("Template Region Normalization", () => {
  it("should normalize valid region and round to 2 decimal places", () => {
    const rawRegion: RawTemplateRegion = {
      xPt: 72.123456,
      yPt: 144.789012,
      wPt: 216.345678,
      hPt: 72.901234,
      pageWidthPt: 612.567890,
      pageHeightPt: 792.123456,
    };

    const normalized = normalizeTemplateRegion(rawRegion);

    expect(normalized.xPt).toBe(72.12);
    expect(normalized.yPt).toBe(144.79);
    expect(normalized.wPt).toBe(216.35);
    expect(normalized.hPt).toBe(72.9);
    expect(normalized.pageWidthPt).toBe(612.57);
    expect(normalized.pageHeightPt).toBe(792.12);
  });

  it("should preserve boundsPt if provided", () => {
    const rawRegion: RawTemplateRegion = {
      xPt: 72,
      yPt: 144,
      wPt: 216,
      hPt: 72,
      pageWidthPt: 612,
      pageHeightPt: 792,
      boundsPt: { x0: 0, y0: 0, x1: 612, y1: 792 },
    };

    const normalized = normalizeTemplateRegion(rawRegion);

    expect(normalized.boundsPt).toEqual({ x0: 0, y0: 0, x1: 612, y1: 792 });
  });

  it("should throw if region is invalid before normalization", () => {
    const invalidRegion: RawTemplateRegion = {
      xPt: 72,
      // Missing yPt
      wPt: 216,
      hPt: 72,
      pageWidthPt: 612,
      pageHeightPt: 792,
    };

    expect(() => normalizeTemplateRegion(invalidRegion)).toThrow();
  });

  it("should produce TemplateRegion type", () => {
    const rawRegion: RawTemplateRegion = {
      xPt: 72,
      yPt: 144,
      wPt: 216,
      hPt: 72,
      pageWidthPt: 612,
      pageHeightPt: 792,
    };

    const normalized = normalizeTemplateRegion(rawRegion);

    // Type check: normalized should be TemplateRegion
    expect(isTemplateRegion(normalized)).toBe(true);
    expect(typeof normalized.xPt).toBe("number");
    expect(typeof normalized.yPt).toBe("number");
    expect(typeof normalized.wPt).toBe("number");
    expect(typeof normalized.hPt).toBe("number");
    expect(typeof normalized.pageWidthPt).toBe("number");
    expect(typeof normalized.pageHeightPt).toBe("number");
  });
});

describe("Coordinate System Normalization", () => {
  it("should normalize undefined to PDF_POINTS_TOP_LEFT", () => {
    expect(normalizeCoordSystem(undefined)).toBe("PDF_POINTS_TOP_LEFT");
  });

  it("should normalize PDF_POINTS to PDF_POINTS_TOP_LEFT", () => {
    expect(normalizeCoordSystem("PDF_POINTS")).toBe("PDF_POINTS_TOP_LEFT");
  });

  it("should keep PDF_POINTS_TOP_LEFT as-is", () => {
    expect(normalizeCoordSystem("PDF_POINTS_TOP_LEFT")).toBe("PDF_POINTS_TOP_LEFT");
  });

  it("should handle empty string as undefined", () => {
    // Empty string should be treated as undefined (though the function doesn't explicitly handle it)
    // This test documents current behavior
    expect(normalizeCoordSystem("")).toBe("PDF_POINTS_TOP_LEFT");
  });
});

describe("Template Region Type Guard", () => {
  const validRegion: TemplateRegion = {
    xPt: 72,
    yPt: 144,
    wPt: 216,
    hPt: 72,
    pageWidthPt: 612,
    pageHeightPt: 792,
  };

  it("should return true for valid TemplateRegion", () => {
    expect(isTemplateRegion(validRegion)).toBe(true);
  });

  it("should return false for null", () => {
    expect(isTemplateRegion(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isTemplateRegion(undefined)).toBe(false);
  });

  it("should return false for non-object", () => {
    expect(isTemplateRegion("string")).toBe(false);
    expect(isTemplateRegion(123)).toBe(false);
    expect(isTemplateRegion(true)).toBe(false);
  });

  it("should return false for object missing xPt", () => {
    const { xPt, ...withoutX } = validRegion;
    expect(isTemplateRegion(withoutX)).toBe(false);
  });

  it("should return false for object with non-numeric xPt", () => {
    expect(isTemplateRegion({ ...validRegion, xPt: "72" as any })).toBe(false);
  });

  it("should return false for object with Infinity", () => {
    expect(isTemplateRegion({ ...validRegion, xPt: Infinity })).toBe(false);
  });

  it("should return false for object with negative wPt", () => {
    expect(isTemplateRegion({ ...validRegion, wPt: -216 })).toBe(false);
  });

  it("should return false for object with zero wPt", () => {
    expect(isTemplateRegion({ ...validRegion, wPt: 0 })).toBe(false);
  });

  it("should return false for object with region extending beyond page", () => {
    expect(isTemplateRegion({ ...validRegion, xPt: 500, wPt: 200 })).toBe(false);
  });

  it("should return false for object with negative xPt", () => {
    expect(isTemplateRegion({ ...validRegion, xPt: -10 })).toBe(false);
  });

  it("should return true for region at page edge", () => {
    const edgeRegion: TemplateRegion = {
      xPt: 396,
      yPt: 144,
      wPt: 216, // 396 + 216 = 612 (pageWidthPt)
      hPt: 72,
      pageWidthPt: 612,
      pageHeightPt: 792,
    };
    expect(isTemplateRegion(edgeRegion)).toBe(true);
  });
});

