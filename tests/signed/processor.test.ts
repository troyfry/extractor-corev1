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
  createSheetsClient: vi.fn(),
}));

// Mock DB services (DB-first architecture)
vi.mock("@/lib/db/services/ingestSigned", () => ({
  ingestSignedAuthoritative: vi.fn(),
}));

vi.mock("@/lib/db/utils/getWorkspaceId", () => ({
  getWorkspaceIdForUser: vi.fn(),
}));

vi.mock("@/lib/signed/dbLookup", () => ({
  findWorkOrderByWoNumber: vi.fn(),
  isDbSignedLookupEnabled: vi.fn(() => true), // Enable DB lookup by default in tests
}));

vi.mock("@/lib/db/drizzle", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []), // Default: no existing signed_match
        })),
      })),
    })),
  },
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
import * as dbLookup from "@/lib/signed/dbLookup";
import * as ingestSigned from "@/lib/db/services/ingestSigned";
import * as getWorkspaceIdUtils from "@/lib/db/utils/getWorkspaceId";

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
    // Mock DB lookup (DB-only architecture - no Sheets fallback)
    vi.mocked(getWorkspaceIdUtils.getWorkspaceIdForUser).mockResolvedValue("workspace-123");
    vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue(null); // Default: work order not found in DB
    vi.mocked(dbLookup.isDbSignedLookupEnabled).mockReturnValue(true); // Enable DB lookup (DB-only mode)
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

    it("should accept missing spreadsheetId (DB-native mode)", async () => {
      const params = { ...baseParams, spreadsheetId: undefined };
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "low",
      });
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue(null);
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      // Should not throw - spreadsheetId is optional in DB-native mode
      await expect(processSignedPdfUnified(params)).resolves.toBeDefined();
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

    it("should handle template not configured gracefully (returns needsReview result)", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockRejectedValue(
        new Error("TEMPLATE_NOT_CONFIGURED")
      );
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      const result = await processSignedPdfUnified(baseParams);

      // Should return a result with needsReview=true, not throw
      expect(result.needsReview).toBe(true);
      expect(result.needsReviewReason).toBe("TEMPLATE_NOT_CONFIGURED");
      expect(result.workOrderNumber).toBe(null);
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
    it("should set needsReview=false for high confidence with work order number that exists in DB", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "high",
        woNumber: "1234567",
      });
      // Mock DB lookup - work order exists in DB (DB-first architecture)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(false);
      expect(result.workOrderNumber).toBe("1234567");
      expect(result.signedPdfUrl).toBeTruthy(); // PDF should be uploaded
      expect(dbLookup.findWorkOrderByWoNumber).toHaveBeenCalled();
      expect(ingestSigned.ingestSignedAuthoritative).toHaveBeenCalled();
    });

    it("should set needsReview=false for medium confidence with work order number that exists in DB", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "medium",
        woNumber: "1234567",
      });
      // Work order exists in DB (DB-first architecture)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(false);
      expect(result.signedPdfUrl).toBeTruthy(); // PDF should be uploaded
      expect(dbLookup.findWorkOrderByWoNumber).toHaveBeenCalled();
    });

    it("should set needsReview=true for low confidence and not upload PDF", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "low",
        woNumber: "1234567",
      });
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(true);
      expect(result.needsReviewReason).toBe("Low confidence extraction"); // Standardized field
      expect(result.woNumber).toBe(result.workOrderNumber); // Standardized alias
      expect(result.signedPdfUrl).toBe(null); // PDF should NOT be uploaded
      expect(drive.uploadPdfToDrive).not.toHaveBeenCalled();
      expect(signedSheets.appendSignedNeedsReviewRow).toHaveBeenCalledWith(
        mockAccessToken,
        mockSpreadsheetId,
        expect.objectContaining({
          reason: "Low confidence extraction", // Matches actual code
          signed_pdf_url: null, // No PDF uploaded
        })
      );
    });

    it("should set needsReview=true when no work order number extracted and not upload PDF", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        woNumber: null,
        confidenceLabel: "high",
      });
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      const result = await processSignedPdfUnified(baseParams);

      expect(result.needsReview).toBe(true);
      expect(result.needsReviewReason).toBe("No work order number extracted"); // Standardized field
      expect(result.woNumber).toBe(null); // Standardized alias
      expect(result.workOrderNumber).toBe(null);
      expect(result.signedPdfUrl).toBe(null); // PDF should NOT be uploaded
      expect(drive.uploadPdfToDrive).not.toHaveBeenCalled();
      expect(signedSheets.appendSignedNeedsReviewRow).toHaveBeenCalledWith(
        mockAccessToken,
        mockSpreadsheetId,
        expect.objectContaining({
          confidence: "high", // OCR confidence (quality), not blocked (no WO number to check)
          ocr_confidence_raw: expect.any(Number), // OCR quality stored separately
          reason: "No work order number extracted",
          signed_pdf_url: null,
        })
      );
    });

    it("should override work order number but set needsReview=true if work order doesn't exist in DB", async () => {
      const params = { ...baseParams, woNumberOverride: "9999999", spreadsheetId: undefined }; // DB-only: no spreadsheetId
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        woNumber: null,
        confidenceLabel: "high", // Use high confidence so work order existence is the reason
      });
      // Mock DB lookup - work order not found (DB-only, no Sheets fallback)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue(null);
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      const result = await processSignedPdfUnified(params);

      expect(result.needsReview).toBe(true); // Should be true because work order doesn't exist
      expect(result.needsReviewReason).toBe("Original work order not found"); // DB-only message
      expect(result.woNumber).toBe("9999999"); // Standardized alias
      expect(result.workOrderNumber).toBe("9999999");
      expect(result.signedPdfUrl).toBe(null); // PDF should NOT be uploaded
      expect(drive.uploadPdfToDrive).not.toHaveBeenCalled();
      // Sheets lookup should NOT be called when spreadsheetId is not provided (DB-only mode)
      expect(sheets.findWorkOrderRecordByJobId).not.toHaveBeenCalled();
      // Sheets write should not be called when spreadsheetId is not provided
      expect(signedSheets.appendSignedNeedsReviewRow).not.toHaveBeenCalled();
    });

    it("should set needsReview=true when work order doesn't exist in DB (DB-only mode)", async () => {
      const params = { ...baseParams, spreadsheetId: undefined }; // DB-only: no spreadsheetId
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "high",
        woNumber: "9999999", // Different WO number that doesn't exist
      });
      // Mock DB lookup - work order not found in DB (DB-only, no Sheets fallback)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue(null);
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      const result = await processSignedPdfUnified(params);

      expect(result.needsReview).toBe(true);
      expect(result.needsReviewReason).toBe("Original work order not found"); // DB-only message
      expect(result.woNumber).toBe("9999999"); // Standardized alias
      expect(result.workOrderNumber).toBe("9999999");
      expect(result.signedPdfUrl).toBe(null); // PDF should NOT be uploaded
      expect(drive.uploadPdfToDrive).not.toHaveBeenCalled();
      expect(dbLookup.findWorkOrderByWoNumber).toHaveBeenCalled(); // DB lookup should be attempted
      // Sheets lookup should NOT be called when spreadsheetId is not provided (DB-only mode)
      expect(sheets.findWorkOrderRecordByJobId).not.toHaveBeenCalled();
      // Sheets write should not be called when spreadsheetId is not provided
      expect(signedSheets.appendSignedNeedsReviewRow).not.toHaveBeenCalled();
    });
  });

  describe("Sheets writing", () => {
    it("should write to Needs Review sheet when needsReview=true and not upload PDF", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        confidenceLabel: "low",
      });
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      await processSignedPdfUnified(baseParams);

      expect(signedSheets.appendSignedNeedsReviewRow).toHaveBeenCalledWith(
        mockAccessToken,
        mockSpreadsheetId,
        expect.objectContaining({
          fmKey: mockFmKey,
          confidence: "blocked", // When low confidence, it's blocked
          ocr_confidence_raw: expect.any(Number), // OCR quality stored separately
          source: "UPLOAD",
          signed_pdf_url: null, // No PDF uploaded
          reason: "Low confidence extraction", // Matches actual code
        })
      );
      expect(sheets.writeWorkOrderRecord).not.toHaveBeenCalled();
      expect(drive.uploadPdfToDrive).not.toHaveBeenCalled();
    });

    it("should save to DB when needsReview=false and work order exists (Sheets export optional)", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      // Work order exists in DB (DB-only mode)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });
      vi.mocked(sheets.writeWorkOrderRecord).mockResolvedValue();
      vi.mocked(sheets.updateJobWithSignedInfoByWorkOrderNumber).mockResolvedValue(true);

      await processSignedPdfUnified(baseParams);

      // DB should be called (authoritative) - this is the primary storage
      expect(ingestSigned.ingestSignedAuthoritative).toHaveBeenCalled();
      // Sheets export is optional and may or may not be called (depends on implementation)
      // In DB-only mode, Sheets is only for export, not for primary storage
      expect(signedSheets.appendSignedNeedsReviewRow).not.toHaveBeenCalled();
      expect(drive.uploadPdfToDrive).toHaveBeenCalled(); // PDF should be uploaded
      // Note: sheets.writeWorkOrderRecord and updateJobWithSignedInfoByWorkOrderNumber
      // may be called for export, but DB is authoritative
    });

    it("should save to DB when work order exists (DB-only, Sheets only for export)", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      // Work order exists in DB (DB-only mode)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });

      await processSignedPdfUnified(baseParams);

      // Should save to DB (authoritative)
      expect(ingestSigned.ingestSignedAuthoritative).toHaveBeenCalled();
      // Sheets export is optional and happens separately (not tested here)
      // No Sheets lookup should occur (DB-only mode)
      expect(sheets.findWorkOrderRecordByJobId).not.toHaveBeenCalled();
      expect(sheets.createSheetsClient).not.toHaveBeenCalled();
    });
  });

  describe("Drive upload", () => {
    it("should upload PDF to Drive only when work order exists in DB", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      // Work order exists in DB (DB-only mode)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });

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
      // DB should be called (authoritative)
      expect(ingestSigned.ingestSignedAuthoritative).toHaveBeenCalled();
    });

    it("should NOT upload PDF to Drive when work order doesn't exist in DB", async () => {
      const params = { ...baseParams, spreadsheetId: undefined }; // DB-only: no spreadsheetId
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue({
        ...mockOcrResult,
        woNumber: "9999999", // Doesn't exist
      });
      // Mock DB lookup - work order not found (DB-only, no Sheets fallback)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue(null);
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

      await processSignedPdfUnified(params);

      expect(drive.uploadPdfToDrive).not.toHaveBeenCalled();
      expect(drive.getOrCreateFolder).not.toHaveBeenCalled();
      // DB lookup should be attempted
      expect(dbLookup.findWorkOrderByWoNumber).toHaveBeenCalled();
      // Sheets lookup should NOT be called when spreadsheetId is not provided (DB-only mode)
      expect(sheets.findWorkOrderRecordByJobId).not.toHaveBeenCalled();
    });

    it("should upload snippet image if available and work order exists in DB", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      // Work order exists in DB (DB-only mode)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });

      await processSignedPdfUnified(baseParams);

      expect(driveSnippets.uploadSnippetImageToDrive).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: mockAccessToken,
          fileName: expect.stringContaining("snippet"),
          pngBuffer: expect.any(Buffer),
        })
      );
      // DB should be called (authoritative)
      expect(ingestSigned.ingestSignedAuthoritative).toHaveBeenCalled();
    });

    it("should handle snippet upload failure gracefully when work order exists in DB", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      // Work order exists in DB (DB-only mode)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockRejectedValue(new Error("Upload failed"));
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });

      const result = await processSignedPdfUnified(baseParams);

      // Should still succeed even if snippet upload fails
      expect(result).toBeDefined();
      expect(result.snippetDriveUrl).toBe(null);
      // DB should still be called (authoritative)
      expect(ingestSigned.ingestSignedAuthoritative).toHaveBeenCalled();
    });
  });

  describe("Result format", () => {
    it("should return correct result structure when work order exists in DB", async () => {
      vi.mocked(templateConfig.getTemplateConfigForFmKey).mockResolvedValue(mockTemplateConfig);
      vi.mocked(signedOcr.callSignedOcrService).mockResolvedValue(mockOcrResult);
      // Work order exists in DB (DB-only mode)
      vi.mocked(dbLookup.findWorkOrderByWoNumber).mockResolvedValue({
        work_order_id: "wo-123",
        job_id: "job-1234567",
        status: "OPEN",
        customer_name: "Test Customer",
        service_address: "123 Test St",
      });
      vi.mocked(drive.getOrCreateFolder).mockResolvedValue("mock-folder-id");
      vi.mocked(drive.uploadPdfToDrive).mockResolvedValue({
        fileId: "mock-file-id",
        webViewLink: "https://drive.google.com/file/d/mock-file-id/view",
        webContentLink: "https://drive.google.com/file/d/mock-file-id/view",
      });
      vi.mocked(driveSnippets.uploadSnippetImageToDrive).mockResolvedValue("https://drive.google.com/file/d/snippet-id/view");
      vi.mocked(ingestSigned.ingestSignedAuthoritative).mockResolvedValue({
        signedDocumentId: "signed-123",
        isNew: true,
        matchedWorkOrderId: "wo-123",
      });

      const result = await processSignedPdfUnified(baseParams);

      expect(result).toMatchObject({
        workOrderNumber: expect.any(String),
        woNumber: expect.any(String), // Standardized alias
        confidence: expect.any(Number),
        confidenceLabel: expect.any(String),
        snippetUrl: expect.any(String), // Standardized: prefers snippetDriveUrl
        needsReview: false,
        needsReviewReason: null, // Should be null when needsReview is false
        signedPdfUrl: expect.any(String), // PDF should be uploaded
        debug: expect.objectContaining({
          templateId: expect.any(String),
          page: expect.any(Number),
        }),
      });

      // Verify woNumber matches workOrderNumber
      expect(result.woNumber).toBe(result.workOrderNumber);
      
      // Verify snippetUrl prefers snippetDriveUrl
      expect(result.snippetUrl).toBe(result.snippetDriveUrl);
      
      // DB should be called (authoritative)
      expect(ingestSigned.ingestSignedAuthoritative).toHaveBeenCalled();
    });
  });

  describe("Gmail source metadata", () => {
    it("should include Gmail metadata in Needs Review record and not upload PDF", async () => {
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
      vi.mocked(sheets.findWorkOrderRecordByJobId).mockResolvedValue(null);
      vi.mocked(signedSheets.appendSignedNeedsReviewRow).mockResolvedValue();

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
          confidence: "blocked", // When low confidence, it's blocked
          ocr_confidence_raw: expect.any(Number), // OCR quality stored separately
          reason: "Low confidence extraction", // Matches actual code
          signed_pdf_url: null, // No PDF uploaded
        })
      );
      expect(drive.uploadPdfToDrive).not.toHaveBeenCalled();
    });
  });
});

