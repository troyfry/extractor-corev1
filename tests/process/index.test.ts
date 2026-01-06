/**
 * Unit tests for Process Access Layer - Index exports
 * 
 * Smoke test to ensure the public API exports are correct.
 */

import { describe, it, expect, vi } from "vitest";

// Mock Next.js server modules that are imported transitively
vi.mock("next/server", () => ({}));
vi.mock("next-auth", () => ({}));

// Mock signed processor to avoid Next.js dependencies
vi.mock("@/lib/signed/processor", () => ({
  processSignedPdfUnified: vi.fn(),
}));

// Mock OCR service to avoid external dependencies
vi.mock("@/lib/workOrders/signedOcr", () => ({
  callSignedOcrService: vi.fn(),
}));

import * as processModule from "@/lib/process";

describe("Process Access Layer - Index Exports", () => {
  it("should export renderPdfPage", () => {
    expect(typeof processModule.renderPdfPage).toBe("function");
  });

  it("should export detectRasterOnlyPdf", () => {
    expect(typeof processModule.detectRasterOnlyPdf).toBe("function");
  });

  it("should export ocrWorkOrderNumberFromUpload", () => {
    expect(typeof processModule.ocrWorkOrderNumberFromUpload).toBe("function");
  });

  it("should export processSignedPdf", () => {
    expect(typeof processModule.processSignedPdf).toBe("function");
  });

  it("should export processWorkOrdersFromGmail", () => {
    expect(typeof processModule.processWorkOrdersFromGmail).toBe("function");
  });

  it("should export types", () => {
    expect(processModule.pdfInputToBuffer).toBeDefined();
    expect(typeof processModule.pdfInputToBuffer).toBe("function");
  });
});

