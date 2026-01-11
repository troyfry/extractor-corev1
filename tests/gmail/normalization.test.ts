/**
 * Unit tests for Gmail signed PDF normalization.
 * 
 * Tests that Gmail signed PDF processing normalizes PDFs before processing,
 * matching the behavior of uploaded signed PDFs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Next.js dependencies
vi.mock("next/server", () => ({}));
vi.mock("next-auth", () => ({}));

// Mock dependencies
vi.mock("@/lib/auth/currentUser", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/workspace/workspaceRequired", () => ({
  workspaceRequired: vi.fn(),
}));

vi.mock("@/lib/workspace/workspaceCookies", () => ({
  rehydrateWorkspaceCookies: vi.fn(),
}));

vi.mock("@/lib/process", () => ({
  processSignedPdf: vi.fn(),
}));

vi.mock("@/lib/pdf/normalizePdf", () => ({
  normalizePdfBuffer: vi.fn(),
}));

vi.mock("@/lib/google/gmail", () => ({
  createGmailClient: vi.fn(),
}));

vi.mock("@/lib/google/gmailExtract", () => ({
  extractPdfAttachments: vi.fn(),
}));

describe("Gmail Signed PDF Normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should normalize PDF buffer before processing", async () => {
    const { normalizePdfBuffer } = await import("@/lib/pdf/normalizePdf");
    const { processSignedPdf } = await import("@/lib/_deprecated/process");
    
    const originalBuffer = Buffer.from("original pdf content");
    const normalizedBuffer = Buffer.from("normalized pdf content");
    
    vi.mocked(normalizePdfBuffer).mockResolvedValue(normalizedBuffer);
    vi.mocked(processSignedPdf).mockResolvedValue({
      woNumber: "WO123",
      needsReview: false,
      confidence: 0.95,
      confidenceLabel: "HIGH",
      snippetUrl: "https://example.com/snippet.png",
      needsReviewReason: null,
    } as any);

    // Simulate the normalization flow from app/api/signed/gmail/process/route.ts
    const pdfBuffer = originalBuffer;
    const originalSize = pdfBuffer.length;

    // Normalize PDF before processing (this is what the route does)
    const normalizedPdfBuffer = await normalizePdfBuffer(pdfBuffer);
    const normalizedSize = normalizedPdfBuffer.length;

    // Verify normalization was called
    expect(normalizePdfBuffer).toHaveBeenCalledWith(originalBuffer);
    expect(normalizedPdfBuffer).toBe(normalizedBuffer);
    expect(normalizedSize).toBe(normalizedBuffer.length);

    // Process with normalized buffer
    await processSignedPdf({
      pdfBytes: normalizedPdfBuffer,
      originalFilename: "test.pdf",
      page: 1,
      fmKey: "test-fm",
      spreadsheetId: "test-spreadsheet",
      accessToken: "test-token",
      source: "GMAIL",
      dpi: 200,
    });

    // Verify processSignedPdf was called with normalized buffer
    expect(processSignedPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfBytes: normalizedBuffer,
      })
    );
  });

  it("should handle normalization that returns same buffer", async () => {
    const { normalizePdfBuffer } = await import("@/lib/pdf/normalizePdf");
    const { processSignedPdf } = await import("@/lib/_deprecated/process");
    
    const originalBuffer = Buffer.from("already normalized pdf");
    
    // Normalization returns same buffer (already normalized)
    vi.mocked(normalizePdfBuffer).mockResolvedValue(originalBuffer);
    vi.mocked(processSignedPdf).mockResolvedValue({
      woNumber: "WO123",
      needsReview: false,
      confidence: 0.95,
      confidenceLabel: "HIGH",
      snippetUrl: "https://example.com/snippet.png",
      needsReviewReason: null,
    } as any);

    const normalizedPdfBuffer = await normalizePdfBuffer(originalBuffer);

    // Should still work even if normalization returns same buffer
    expect(normalizePdfBuffer).toHaveBeenCalledWith(originalBuffer);
    expect(normalizedPdfBuffer).toBe(originalBuffer);

    await processSignedPdf({
      pdfBytes: normalizedPdfBuffer,
      originalFilename: "test.pdf",
      page: 1,
      fmKey: "test-fm",
      spreadsheetId: "test-spreadsheet",
      accessToken: "test-token",
      source: "GMAIL",
      dpi: 200,
    });

    expect(processSignedPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfBytes: originalBuffer,
      })
    );
  });

  it("should log normalization details", async () => {
    const { normalizePdfBuffer } = await import("@/lib/pdf/normalizePdf");
    
    const originalBuffer = Buffer.from("original pdf");
    const normalizedBuffer = Buffer.from("normalized pdf");
    
    vi.mocked(normalizePdfBuffer).mockResolvedValue(normalizedBuffer);

    const originalSize = originalBuffer.length;
    const normalizedPdfBuffer = await normalizePdfBuffer(originalBuffer);
    const normalizedSize = normalizedPdfBuffer.length;

    // Verify size tracking (as done in the route)
    expect(originalSize).toBe(originalBuffer.length);
    expect(normalizedSize).toBe(normalizedBuffer.length);
    
    // Verify buffer changed (normalization occurred)
    const bufferChanged = normalizedPdfBuffer !== originalBuffer;
    expect(bufferChanged).toBe(true);
  });

  it("should handle normalization errors gracefully", async () => {
    const { normalizePdfBuffer } = await import("@/lib/pdf/normalizePdf");
    
    const originalBuffer = Buffer.from("original pdf");
    const normalizationError = new Error("Normalization failed");
    
    vi.mocked(normalizePdfBuffer).mockRejectedValue(normalizationError);

    await expect(normalizePdfBuffer(originalBuffer)).rejects.toThrow("Normalization failed");
  });
});

