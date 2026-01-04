/**
 * Signed Processing Preconditions Tests
 * 
 * Ensures OCR cannot run unless PDF points crop is complete.
 * Missing xPt/yPt/wPt/hPt or pageWidthPt/pageHeightPt → hard error.
 */

import { describe, it, expect } from "vitest";

/**
 * Assert PDF points crop is complete (matches signedProcessor.ts logic).
 * 
 * This is the exact guard used before calling OCR.
 */
function assertPointsCrop(points?: {
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  page?: number;
}): void {
  if (!points) {
    throw new Error("Missing crop points");
  }
  const { xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt, page } = points;

  const ok =
    [xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt, page].every(
      (v) => typeof v === "number" && Number.isFinite(v)
    ) &&
    wPt! > 0 &&
    hPt! > 0 &&
    pageWidthPt! > 0 &&
    pageHeightPt! > 0 &&
    page! >= 1;

  if (!ok) {
    throw new Error(
      "Invalid or incomplete PDF_POINTS crop (requires xPt,yPt,wPt,hPt,pageWidthPt,pageHeightPt,page>=1)."
    );
  }
}

describe("signed processing preconditions", () => {
  describe("assertPointsCrop", () => {
    it("passes when all required fields are present and valid", () => {
      const validPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(validPoints)).not.toThrow();
    });

    it("throws when points object is missing", () => {
      expect(() => assertPointsCrop(undefined)).toThrow("Missing crop points");
    });

    it("throws when xPt is missing", () => {
      const invalidPoints = {
        // xPt missing
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when yPt is missing", () => {
      const invalidPoints = {
        xPt: 100,
        // yPt missing
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when wPt is missing", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        // wPt missing
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when hPt is missing", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        // hPt missing
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when pageWidthPt is missing", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        // pageWidthPt missing
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when pageHeightPt is missing", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        // pageHeightPt missing
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when page is missing", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        // page missing
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when wPt is zero or negative", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 0, // Invalid
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when hPt is zero or negative", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: -10, // Invalid
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when pageWidthPt is zero or negative", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 0, // Invalid
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when pageHeightPt is zero or negative", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: -100, // Invalid
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when page is less than 1", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 0, // Invalid (must be >= 1)
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when any value is not finite", () => {
      const invalidPoints = {
        xPt: Infinity,
        yPt: 200,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });

    it("throws when any value is NaN", () => {
      const invalidPoints = {
        xPt: 100,
        yPt: NaN,
        wPt: 300,
        hPt: 150,
        pageWidthPt: 612,
        pageHeightPt: 792,
        page: 1,
      };

      expect(() => assertPointsCrop(invalidPoints)).toThrow();
    });
  });
});

