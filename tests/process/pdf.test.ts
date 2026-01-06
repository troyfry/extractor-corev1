/**
 * Unit tests for Process Access Layer - PDF operations
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Mock dependencies
vi.mock("@/lib/pdf/renderPdfPage", () => ({
  renderPdfPageToPng: vi.fn().mockResolvedValue({
    pngDataUrl: "data:image/png;base64,test",
    widthPx: 100,
    heightPx: 200,
    pageWidthPt: 612,
    pageHeightPt: 792,
    boundsPt: { x0: 0, y0: 0, x1: 612, y1: 792 },
    page: 1,
    totalPages: 1,
  }),
}));

vi.mock("@/lib/templates", () => ({
  detectRasterOnlyPdf: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/pdf/normalizePdf", () => ({
  normalizePdfBuffer: vi.fn().mockImplementation((buf) => Promise.resolve(buf)),
}));

vi.mock("@/lib/pdf/intent", () => ({
  resolvePdfIntentPolicy: vi.fn().mockImplementation((args) => {
    if (args.intent === "TEMPLATE_CAPTURE") {
      return {
        intent: "TEMPLATE_CAPTURE",
        normalize: false,
        skipNormalization: true,
        allowRaster: args.allowRaster === "true" || args.allowRaster === true,
        shouldBlockRaster: !(args.allowRaster === "true" || args.allowRaster === true),
        reason: "template_capture",
      };
    }
    return {
      intent: args.intent || null,
      normalize: true,
      skipNormalization: false,
      allowRaster: true,
      shouldBlockRaster: false,
      reason: "legacy",
    };
  }),
  parsePdfIntent: vi.fn().mockImplementation((val) => {
    if (val === "TEMPLATE_CAPTURE") return "TEMPLATE_CAPTURE";
    if (val === "SIGNED_PROCESSING") return "SIGNED_PROCESSING";
    if (val === "GENERAL_VIEW") return "GENERAL_VIEW";
    return null;
  }),
}));

// Import after mocks
import { renderPdfPage, detectRasterOnlyPdf } from "@/lib/process";

describe("Process Access Layer - PDF Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("renderPdfPage", () => {
    it("should render PDF page with TEMPLATE_CAPTURE intent and block raster", async () => {
      const pdfBuffer = Buffer.from("test pdf content");
      
      // Mock raster detection to return true (should block)
      const { detectRasterOnlyPdf: mockDetect } = await import("@/lib/templates");
      vi.mocked(mockDetect).mockResolvedValueOnce(true);

      await expect(
        renderPdfPage({
          pdf: pdfBuffer,
          page: 1,
          intent: "TEMPLATE_CAPTURE",
          allowRaster: false,
        })
      ).rejects.toThrow("Template capture requires a digital PDF");
    });

    it("should render PDF page with TEMPLATE_CAPTURE intent and allow raster when allowRaster=true", async () => {
      const pdfBuffer = Buffer.from("test pdf content");
      
      const result = await renderPdfPage({
        pdf: pdfBuffer,
        page: 1,
        intent: "TEMPLATE_CAPTURE",
        allowRaster: true,
      });

      expect(result).toBeDefined();
      expect(result.pngDataUrl).toBe("data:image/png;base64,test");
    });

    it("should normalize PDF when intent is SIGNED_PROCESSING", async () => {
      const pdfBuffer = Buffer.from("test pdf content");
      const { normalizePdfBuffer } = await import("@/lib/pdf/normalizePdf");
      const normalizedBuffer = Buffer.from("normalized content");
      vi.mocked(normalizePdfBuffer).mockResolvedValueOnce(normalizedBuffer);

      await renderPdfPage({
        pdf: pdfBuffer,
        page: 1,
        intent: "SIGNED_PROCESSING",
      });

      expect(normalizePdfBuffer).toHaveBeenCalled();
    });
  });

  describe("detectRasterOnlyPdf", () => {
    it("should detect raster-only PDF", async () => {
      const pdfBuffer = Buffer.from("test pdf content");
      const { detectRasterOnlyPdf: mockDetect } = await import("@/lib/templates");
      vi.mocked(mockDetect).mockResolvedValueOnce(true);

      const result = await detectRasterOnlyPdf({ pdf: pdfBuffer });

      expect(result.isRasterOnly).toBe(true);
    });

    it("should detect non-raster PDF", async () => {
      const pdfBuffer = Buffer.from("test pdf content");
      const { detectRasterOnlyPdf: mockDetect } = await import("@/lib/templates");
      vi.mocked(mockDetect).mockResolvedValueOnce(false);

      const result = await detectRasterOnlyPdf({ pdf: pdfBuffer });

      expect(result.isRasterOnly).toBe(false);
    });
  });
});

