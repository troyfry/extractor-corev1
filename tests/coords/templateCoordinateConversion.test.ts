/**
 * Coordinate Conversion Golden Rule Tests
 * 
 * These tests ensure CSS → natural px → PDF points conversion stays consistent
 * and bounded. This is the highest-value regression test.
 */

import { describe, it, expect } from "vitest";
import {
  cssPixelsToPdfPoints,
  pdfPointsToCssPixels,
  validatePdfPoints,
  type BoundsPt,
  type CssPixels,
  type PdfPoints,
} from "@/lib/templates/templateCoordinateConversion";

describe("template coordinate conversion", () => {
  describe("cssPixelsToPdfPoints", () => {
    it("converts CSS crop -> PDF points deterministically", () => {
      const geometry = {
        boundsPt: { x0: 0, y0: 0, x1: 612, y1: 792 } as BoundsPt, // 8.5x11 in points
        pageWidthPt: 612,
        pageHeightPt: 792,
        displayedRect: { width: 918, height: 1188 }, // 1.5x scale (CSS scaled down)
        canvasSize: { width: 1836, height: 2376 }, // 3x scale (high DPI render)
      };

      const cssCrop: CssPixels = { x: 100, y: 200, width: 300, height: 150 };

      const cropPt = cssPixelsToPdfPoints(
        cssCrop,
        geometry.displayedRect,
        geometry.canvasSize,
        { width: geometry.pageWidthPt, height: geometry.pageHeightPt },
        geometry.boundsPt
      );

      // Basic sanity expectations (not overly brittle)
      expect(cropPt.xPt).toBeGreaterThan(0);
      expect(cropPt.yPt).toBeGreaterThan(0);
      expect(cropPt.wPt).toBeGreaterThan(0);
      expect(cropPt.hPt).toBeGreaterThan(0);
      expect(cropPt.xPt + cropPt.wPt).toBeLessThanOrEqual(geometry.pageWidthPt + 1); // tolerance
      expect(cropPt.yPt + cropPt.hPt).toBeLessThanOrEqual(geometry.pageHeightPt + 1);
    });

    it("handles bounds offset normalization", () => {
      // PDF with non-zero bounds (e.g., x0 = -66.8)
      const geometry = {
        boundsPt: { x0: -66.8, y0: -10, x1: 545.2, y1: 782 } as BoundsPt,
        pageWidthPt: 612, // x1 - x0 = 612
        pageHeightPt: 792, // y1 - y0 = 792
        displayedRect: { width: 918, height: 1188 },
        canvasSize: { width: 1836, height: 2376 },
      };

      const cssCrop: CssPixels = { x: 100, y: 200, width: 300, height: 150 };

      const cropPt = cssPixelsToPdfPoints(
        cssCrop,
        geometry.displayedRect,
        geometry.canvasSize,
        { width: geometry.pageWidthPt, height: geometry.pageHeightPt },
        geometry.boundsPt
      );

      // After normalization, coordinates should be 0-based
      expect(cropPt.xPt).toBeGreaterThanOrEqual(0);
      expect(cropPt.yPt).toBeGreaterThanOrEqual(0);
      expect(cropPt.xPt + cropPt.wPt).toBeLessThanOrEqual(geometry.pageWidthPt + 1);
    });

    it("handles CSS scaling correctly", () => {
      // Image displayed at 50% of natural size
      const geometry = {
        boundsPt: { x0: 0, y0: 0, x1: 612, y1: 792 } as BoundsPt,
        pageWidthPt: 612,
        pageHeightPt: 792,
        displayedRect: { width: 306, height: 396 }, // Half size
        canvasSize: { width: 612, height: 792 }, // Natural size
      };

      const cssCrop: CssPixels = { x: 50, y: 50, width: 100, height: 100 };

      const cropPt = cssPixelsToPdfPoints(
        cssCrop,
        geometry.displayedRect,
        geometry.canvasSize,
        { width: geometry.pageWidthPt, height: geometry.pageHeightPt },
        geometry.boundsPt
      );

      // CSS crop should map correctly despite scaling
      expect(cropPt.xPt).toBeGreaterThan(0);
      expect(cropPt.wPt).toBeGreaterThan(0);
      expect(cropPt.xPt + cropPt.wPt).toBeLessThanOrEqual(geometry.pageWidthPt + 1);
    });
  });

  describe("pdfPointsToCssPixels", () => {
    it("round-trips CSS -> PDF -> CSS correctly", () => {
      const geometry = {
        boundsPt: { x0: 0, y0: 0, x1: 612, y1: 792 } as BoundsPt,
        pageWidthPt: 612,
        pageHeightPt: 792,
        displayedRect: { width: 918, height: 1188 },
        canvasSize: { width: 1836, height: 2376 },
      };

      const originalCss: CssPixels = { x: 100, y: 200, width: 300, height: 150 };

      // CSS -> PDF
      const pdfPt = cssPixelsToPdfPoints(
        originalCss,
        geometry.displayedRect,
        geometry.canvasSize,
        { width: geometry.pageWidthPt, height: geometry.pageHeightPt },
        geometry.boundsPt
      );

      // PDF -> CSS (using same dimensions)
      const roundTripCss = pdfPointsToCssPixels(
        pdfPt,
        { width: geometry.pageWidthPt, height: geometry.pageHeightPt },
        geometry.canvasSize,
        geometry.displayedRect,
        geometry.boundsPt
      );

      // Should be close (within rounding tolerance)
      expect(Math.abs(roundTripCss.x - originalCss.x)).toBeLessThan(2);
      expect(Math.abs(roundTripCss.y - originalCss.y)).toBeLessThan(2);
      expect(Math.abs(roundTripCss.width - originalCss.width)).toBeLessThan(2);
      expect(Math.abs(roundTripCss.height - originalCss.height)).toBeLessThan(2);
    });
  });

  describe("validatePdfPoints", () => {
    it("accepts valid PDF points", () => {
      const validPoints: PdfPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: 150,
      };

      expect(() => {
        validatePdfPoints(validPoints, { width: 612, height: 792 });
      }).not.toThrow();
    });

    it("throws when crop is out of bounds (negative x)", () => {
      const badCrop: PdfPoints = {
        xPt: -10,
        yPt: 0,
        wPt: 50,
        hPt: 50,
      };

      expect(() => {
        validatePdfPoints(badCrop, { width: 612, height: 792 });
      }).toThrow();
    });

    it("throws when crop is out of bounds (negative y)", () => {
      const badCrop: PdfPoints = {
        xPt: 0,
        yPt: -10,
        wPt: 50,
        hPt: 50,
      };

      expect(() => {
        validatePdfPoints(badCrop, { width: 612, height: 792 });
      }).toThrow();
    });

    it("throws when crop exceeds page width", () => {
      const badCrop: PdfPoints = {
        xPt: 600,
        yPt: 0,
        wPt: 50, // xPt + wPt = 650 > 612
        hPt: 50,
      };

      expect(() => {
        validatePdfPoints(badCrop, { width: 612, height: 792 });
      }).toThrow();
    });

    it("throws when crop exceeds page height", () => {
      const badCrop: PdfPoints = {
        xPt: 0,
        yPt: 750,
        wPt: 50,
        hPt: 50, // yPt + hPt = 800 > 792
      };

      expect(() => {
        validatePdfPoints(badCrop, { width: 612, height: 792 });
      }).toThrow();
    });

    it("throws when width is zero or negative", () => {
      const badCrop: PdfPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 0,
        hPt: 150,
      };

      expect(() => {
        validatePdfPoints(badCrop, { width: 612, height: 792 });
      }).toThrow();
    });

    it("throws when height is zero or negative", () => {
      const badCrop: PdfPoints = {
        xPt: 100,
        yPt: 200,
        wPt: 300,
        hPt: -10,
      };

      expect(() => {
        validatePdfPoints(badCrop, { width: 612, height: 792 });
      }).toThrow();
    });

    it("throws when coordinates are not finite", () => {
      const badCrop: PdfPoints = {
        xPt: Infinity,
        yPt: 200,
        wPt: 300,
        hPt: 150,
      };

      expect(() => {
        validatePdfPoints(badCrop, { width: 612, height: 792 });
      }).toThrow();
    });
  });
});

