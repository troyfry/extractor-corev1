/**
 * PDF.js Utility Tests
 * 
 * Tests for extracting page dimensions and bounds from PDF.js page.view arrays.
 * This ensures coordinate extraction logic is correct for template capture.
 * 
 * Why this matters: Template capture relies on accurate PDF page dimensions
 * extracted from PDF.js. Incorrect extraction causes coordinate conversion errors.
 */

import { describe, it, expect } from "vitest";
import { extractPdfJsPageDimensions } from "@/lib/templates/pdfJsUtils";

describe("PDF.js page dimension extraction", () => {
  it("should extract dimensions from standard 8.5x11 page (0-based)", () => {
    // Standard US Letter: 612 x 792 points (8.5" x 11" at 72 DPI)
    // page.view = [0, 0, 612, 792]
    const pageView: [number, number, number, number] = [0, 0, 612, 792];

    const result = extractPdfJsPageDimensions(pageView);

    expect(result.pageWidthPt).toBe(612);
    expect(result.pageHeightPt).toBe(792);
    expect(result.boundsPt).toEqual({ x0: 0, y0: 0, x1: 612, y1: 792 });
  });

  it("should extract dimensions from page with non-zero origin", () => {
    // Some PDFs have non-zero origins (e.g., scanned PDFs with offset)
    // page.view = [-66.8, -66.8, 545.2, 725.2]
    // Effective size is still 612 x 792, but bounds start at (-66.8, -66.8)
    const pageView: [number, number, number, number] = [-66.8, -66.8, 545.2, 725.2];

    const result = extractPdfJsPageDimensions(pageView);

    expect(result.pageWidthPt).toBe(612); // 545.2 - (-66.8) = 612
    expect(result.pageHeightPt).toBe(792); // 725.2 - (-66.8) = 792
    expect(result.boundsPt).toEqual({ x0: -66.8, y0: -66.8, x1: 545.2, y1: 725.2 });
  });

  it("should extract dimensions from A4 page", () => {
    // A4: 595.276 x 841.890 points (210mm x 297mm at 72 DPI)
    const pageView: [number, number, number, number] = [0, 0, 595.276, 841.89];

    const result = extractPdfJsPageDimensions(pageView);

    expect(result.pageWidthPt).toBeCloseTo(595.276, 2);
    expect(result.pageHeightPt).toBeCloseTo(841.89, 2);
    expect(result.boundsPt).toEqual({ x0: 0, y0: 0, x1: 595.276, y1: 841.89 });
  });

  it("should throw error for invalid array length", () => {
    // @ts-expect-error - Testing invalid input
    expect(() => extractPdfJsPageDimensions([0, 0, 612])).toThrow(
      "pageView must be an array of 4 numbers"
    );

    // @ts-expect-error - Testing invalid input
    expect(() => extractPdfJsPageDimensions([0, 0, 612, 792, 1000])).toThrow(
      "pageView must be an array of 4 numbers"
    );
  });

  it("should throw error for non-numeric values", () => {
    // @ts-expect-error - Testing invalid input
    expect(() => extractPdfJsPageDimensions(["0", 0, 612, 792])).toThrow(
      "pageView must contain only numbers"
    );

    // @ts-expect-error - Testing invalid input
    expect(() => extractPdfJsPageDimensions([0, null, 612, 792])).toThrow(
      "pageView must contain only numbers"
    );
  });

  it("should throw error for invalid bounds (x1 <= x0)", () => {
    const pageView: [number, number, number, number] = [100, 0, 50, 792]; // x1 < x0

    expect(() => extractPdfJsPageDimensions(pageView)).toThrow(
      "Invalid page bounds: x1 (50) must be > x0 (100)"
    );
  });

  it("should throw error for invalid bounds (y1 <= y0)", () => {
    const pageView: [number, number, number, number] = [0, 100, 612, 50]; // y1 < y0

    // Error message includes both x and y validation, but y is the issue here
    expect(() => extractPdfJsPageDimensions(pageView)).toThrow(
      "Invalid page bounds"
    );
    expect(() => extractPdfJsPageDimensions(pageView)).toThrow(
      "y1 (50) must be > y0 (100)"
    );
  });

  it("should throw error for equal bounds (x1 === x0)", () => {
    const pageView: [number, number, number, number] = [0, 0, 0, 792]; // x1 === x0

    expect(() => extractPdfJsPageDimensions(pageView)).toThrow(
      "Invalid page bounds: x1 (0) must be > x0 (0)"
    );
  });

  it("should handle decimal values correctly", () => {
    const pageView: [number, number, number, number] = [10.5, 20.25, 622.75, 812.125];

    const result = extractPdfJsPageDimensions(pageView);

    expect(result.pageWidthPt).toBe(612.25); // 622.75 - 10.5
    expect(result.pageHeightPt).toBe(791.875); // 812.125 - 20.25
    expect(result.boundsPt).toEqual({ x0: 10.5, y0: 20.25, x1: 622.75, y1: 812.125 });
  });
});

