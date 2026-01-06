/**
 * Unit tests for Process Access Layer - Index exports
 * 
 * Smoke test to ensure the public API exports are correct.
 */

import { describe, it, expect } from "vitest";
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

