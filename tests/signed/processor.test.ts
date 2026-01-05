/**
 * Unit tests for unified signed PDF processor.
 * 
 * Tests the processSignedPdfUnified function to ensure:
 * - Input validation works correctly
 * - Template loading and validation
 * - OCR service integration
 * - Decision logic (needsReview)
 * - Sheets writing (both paths)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Next.js dependencies first
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(),
  })),
}));

vi.mock("@/lib/auth/currentUser", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/userSettings/repository", () => ({
  getUserSpreadsheetId: vi.fn(),
}));

// Mock all other dependencies
vi.mock("@/lib/workOrders/templateConfig", () => ({
  getTemplateConfigForFmKey: vi.fn(),
}));

vi.mock("@/lib/workOrders/signedOcr", () => ({
  callSignedOcrService: vi.fn(),
}));

vi.mock("@/lib/workOrders/signedSheets", () => ({
  appendSignedNeedsReviewRow: vi.fn(),
}));

vi.mock("@/lib/google/sheets", () => ({
  writeWorkOrderRecord: vi.fn(),
  findWorkOrderRecordByJobId: vi.fn(),
  updateJobWithSignedInfoByWorkOrderNumber: vi.fn(),
}));

vi.mock("@/lib/google/drive", () => ({
  uploadPdfToDrive: vi.fn(),
  getOrCreateFolder: vi.fn(),
}));

vi.mock("@/lib/drive-snippets", () => ({
  uploadSnippetImageToDrive: vi.fn(),
}));

vi.mock("@/lib/workOrders/sheetsIngestion", () => ({
  generateJobId: vi.fn(),
}));

vi.mock("@/lib/templates/fmProfiles", () => ({
  normalizeFmKey: vi.fn((key: string) => key.toLowerCase().trim()),
}));

import { processSignedPdfUnified, type ProcessSignedPdfParams } from "@/lib/signed/processor";
import * as templateConfig from "@/lib/workOrders/templateConfig";
import * as signedOcr from "@/lib/workOrders/signedOcr";
import * as signedSheets from "@/lib/workOrders/signedSheets";
import * as sheets from "@/lib/google/sheets";
import * as drive from "@/lib/google/drive";
import * as driveSnippets from "@/lib/drive-snippets";
import * as sheetsIngestion from "@/lib/workOrders/sheetsIngestion";

describe("processSignedPdfUnified", () => {
  const mockAccessToken = "mock-access-token";
  const mockSpreadsheetId = "mock-spreadsheet-id";
  const mockFmKey = "superclean";
  const mockPdfBuffer = Buffer.from("mock-pdf-content");
  const mockOriginalFilename = "test-work-order.pdf";

  const baseParams: ProcessSignedPdfParams = {
    pdfBytes: mockPdfBuffer,
    originalFilename: mockOriginalFilename,
    page: 1,
    fmKey: mockFmKey,
    spreadsheetId: mockSpreadsheetId,
    accessToken: mockAccessToken,
    source: "UPLOAD",
    dpi: 200,
  };

  const mockTemplateConfig = {
    templateId: "superclean",
    page: 1,
    region: { xPct: 0.1, yPct: 0.2, wPct: 0.3, hPct: 0.4 },
    dpi: 200,
    xPt: 100,
    yPt: 200,
    wPt: 300,
    hPt: 150,
    pageWidthPt: 612,
    pageHeightPt: 792,
  };

  const mockOcrResult = {
    woNumber: "1234567",
    rawText: "WO 1234567",
    confidenceLabel: "high" as const,
    confidenceRaw: 0.95,
    snippetImageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock generateJobId
    vi.mocked(sheetsIngestion.generateJobId).mockImplementation((issuer, woNumber) => {
      return `job-${woNumber || "unknown"}`;
    });
  });

  describe("Input validation", () => {
    it("should throw if pdfBytes is empty", async () => {
      const params = { ...baseParams, pdfBytes: Buffer.alloc(0) };
      await expect(processSignedPdfUnified(params)).rejects.toThrow("pdfBytes is required");
    });

    it("should throw if fmKey is missing", async () => {
      const params = { ...baseParams, fmKey: "" };
      await expect(processSignedPdfUnified(params)).rejects.toThrow("fmKey is required");
    });

    it("should throw if spreadsheetId is missing", async () => {
      const params = { ...baseParams, spreadsheetId: "" };
      await expect(processSignedPdfUnified(params)).rejects.toThrow("spreadsheetId is required");
    });

    it("should throw if accessToken is missing", async () => {
      const params = { ...baseParams, accessToken: "" };
      await expect(processSignedPdfUnified(params)).rejects.toThrow("accessToken is required");
    });

    it("should throw if page is less than 1", async () => {
      const params = { ...baseParams, page: 0 };
      await expect(processSignedPdfUnified(params)).rejects.toThrow("page must be >= 1");
    });

    it("should accept Uint8Array as pdfBytes", async () => {
      const params = { ...baseParams, pdfBytes: new Uint8Array([1, 2, 3]) };
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await expect(processSignedPdfUnified(params)).resolves.toBeDefined();
    });
  });

  describe("Template loading", () => {
    it("should load template config for fmKey", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await processSignedPdfUnified(baseParams);

      expect(templateConfig.getTemplateConfigForFmKey).toHaveBeenCalledWith(mockFmKey);
    });

    it("should throw if template is not configured", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockRejectedValue(
        new Error("TEMPLATE_NOT_CONFIGURED")
      );

      await expect(processSignedPdfUnified(baseParams)).rejects.toThrow(
        "Template not configured for FM key"
      );
    });

    it("should throw if template is missing PDF points", async () => {
      const incompleteTemplate = {
        ...mockTemplateConfig,
        xPt: undefined,
      };
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(incompleteTemplate as any);

      await expect(processSignedPdfUnified(baseParams)).rejects.toThrow(
        "Template for FM key"
      );
    });
  });

  describe("OCR service integration", () => {
    it("should call OCR service with correct parameters", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await processSignedPdfUnified(baseParams);

      expect(signedOcr.callSignedOcrService).toHaveBeenCalledWith(
        mockPdfBuffer,
        mockOriginalFilename,
        expect.objectContaining({
          templateId: mockTemplateConfig.templateId,
          page: 1,
          xPt: mockTemplateConfig.xPt,
          yPt: mockTemplateConfig.yPt,
          wPt: mockTemplateConfig.wPt,
          hPt: mockTemplateConfig.hPt,
          pageWidthPt: mockTemplateConfig.pageWidthPt,
          pageHeightPt: mockTemplateConfig.pageHeightPt,
          dpi: 200,
        })
      );
    });
  });

  describe("Decision logic", () => {
    it("should set needsReview=false for high confidence with work order number", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "high",
        woNumber: "1234567",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(false);
      expect(result.workOrderNumber).toBe("1234567");
    });

    it("should set needsReview=false for medium confidence with work order number", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "medium",
        woNumber: "1234567",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(false);
    });

    it("should set needsReview=true for low confidence", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "low",
        woNumber: "1234567",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(true);
    });

    it("should set needsReview=true when no work order number extracted", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        woNumber: null,
        confidenceLabel: "high",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(true);
      expect(result.workOrderNumber).toBe(null);
    });

    it("should override work order number and set needsReview=false when woNumberOverride provided", async () => {
      const params = { ...baseParams, woNumberOverride: "9999999" };
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        woNumber: null,
        confidenceLabel: "low",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      const result = await processSignedPdfUnified(params);

      expect(result.needsReview).toBe(false);
      expect(result.workOrderNumber).toBe("9999999");
    });
  });

  describe("Sheets writing", () => {
    it("should write to Needs Review sheet when needsReview=true", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "low",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");

      await processSignedPdfUnified(baseParams);

      expect(signedSheets.appendSignedNeedsReviewRow).toHaveBeenCalledWith(
        mockAccessToken,
        mockSpreadsheetId,
        expect.objectContaining({
          fmKey: mockFmKey,
          confidence: "low",
          source: "UPLOAD",
        })
      );
      expect(sheets.writeWorkOrderRecord).not.toHaveBeenCalled();
    });

    it("should write to Work Orders sheet when needsReview=false", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await processSignedPdfUnified(baseParams);

      expect(sheets.writeWorkOrderRecord).toHaveBeenCalled();
      expect(signedSheets.appendSignedNeedsReviewRow).not.toHaveBeenCalled();
    });

    it("should update Sheet1 when work order exists", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await processSignedPdfUnified(baseParams);

      expect(sheets.updateJobWithSignedInfoByWorkOrderNumber).toHaveBeenCalledWith(
        mockAccessToken,
        mockSpreadsheetId,
        "Sheet1",
        "1234567",
        expect.objectContaining({
          signedPdfUrl: expect.any(String),
          confidence: "high",
          statusOverride: "SIGNED",
        })
      );
    });
  });

  describe("Drive upload", () => {
    it("should upload PDF to Drive", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await processSignedPdfUnified(baseParams);

      expect(drive.getOrCreateFolder).toHaveBeenCalledWith(
        mockAccessToken,
        "Signed Work Orders"
      );
      expect(drive.uploadPdfToDrive).toHaveBeenCalledWith(
        mockAccessToken,
        mockPdfBuffer,
        mockOriginalFilename,
        "mock-folder-id"
      );
    });

    it("should upload snippet image if available", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await processSignedPdfUnified(baseParams);

      expect(driveSnippets.uploadSnippetImageToDrive).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: mockAccessToken,
          fileName: expect.stringContaining("snippet"),
          pngBuffer: expect.any(Buffer),
        })
      );
    });

    it("should handle snippet upload failure gracefully", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockRejectedValue(new Error("Upload failed"));
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      const result = await processSignedPdfUnified(baseParams);

      // Should still succeed even if snippet upload fails
      expect(result).toBeDefined();
      expect(result.snippetDriveUrl).toBe(null);
    });
  });

  describe("Result format", () => {
    it("should return correct result structure", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      const result = await processSignedPdfUnified(baseParams);

      expect(result).toMatchObject({
        workOrderNumber: expect.any(String),
        confidence: expect.any(Number),
        confidenceLabel: expect.any(String),
        needsReview: expect.any(Boolean),
        debug: expect.objectContaining({
          templateId: expect.any(String),
          page: expect.any(Number),
        }),
      });
    });
  });

  describe("Gmail source metadata", () => {
    it("should include Gmail metadata in Needs Review record", async () => {
      const params: ProcessSignedPdfParams = {
        ...baseParams,
        source: "GMAIL",
        sourceMeta: {
          gmailMessageId: "msg-123",
          gmailAttachmentId: "att-456",
          gmailFrom: "sender@example.com",
          gmailSubject: "Test Subject",
          gmailDate: "2024-01-01T00:00:00Z",
        },
      };

      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "low",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");

      await processSignedPdfUnified(params);

      expect(signedSheets.appendSignedNeedsReviewRow).toHaveBeenCalledWith(
        mockAccessToken,
        mockSpreadsheetId,
        expect.objectContaining({
          source: "GMAIL",
          gmail_message_id: "msg-123",
          gmail_attachment_id: "att-456",
          gmail_from: "sender@example.com",
          gmail_subject: "Test Subject",
          gmail_date: "2024-01-01T00:00:00Z",
        })
      );
    });
  });
});

