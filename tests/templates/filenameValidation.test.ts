/**
 * Filename Validation Tests
 * 
 * Tests for validating PDF filenames to detect signed/scan PDFs.
 * 
 * Why this matters: Signed scans and phone photo PDFs should be blocked
 * from template capture. Filename heuristics provide a quick pre-check.
 */

import { describe, it, expect } from "vitest";
import { isSignedPdfFilename } from "@/lib/templates";

describe("Filename Validation (Signed/Scan Detection)", () => {
  describe("Should detect signed PDFs", () => {
    it("should detect 'signed' in filename", () => {
      expect(isSignedPdfFilename("keystone_signed.pdf")).toBe(true);
      expect(isSignedPdfFilename("workorder-signed.pdf")).toBe(true);
      expect(isSignedPdfFilename("SIGNED_document.pdf")).toBe(true);
    });

    it("should detect 'signoff' in filename", () => {
      expect(isSignedPdfFilename("wo_signoff.pdf")).toBe(true);
      expect(isSignedPdfFilename("signoff_complete.pdf")).toBe(true);
    });

    it("should detect 'sign' in filename", () => {
      expect(isSignedPdfFilename("document_sign.pdf")).toBe(true);
      expect(isSignedPdfFilename("signed_workorder.pdf")).toBe(true);
    });

    it("should detect 'signature' in filename", () => {
      expect(isSignedPdfFilename("wo_signature.pdf")).toBe(true);
      expect(isSignedPdfFilename("signature_page.pdf")).toBe(true);
    });

    it("should detect 'completed' in filename", () => {
      expect(isSignedPdfFilename("wo_completed.pdf")).toBe(true);
      expect(isSignedPdfFilename("completed_job.pdf")).toBe(true);
    });

    it("should detect 'final' in filename", () => {
      expect(isSignedPdfFilename("wo_final.pdf")).toBe(true);
      expect(isSignedPdfFilename("final_version.pdf")).toBe(true);
    });

    it("should detect 'executed' in filename", () => {
      expect(isSignedPdfFilename("wo_executed.pdf")).toBe(true);
      expect(isSignedPdfFilename("executed_contract.pdf")).toBe(true);
    });

    it("should detect 'proof' in filename", () => {
      expect(isSignedPdfFilename("wo_proof.pdf")).toBe(true);
      expect(isSignedPdfFilename("proof_of_completion.pdf")).toBe(true);
    });

    it("should detect 'kent' in filename (test files)", () => {
      expect(isSignedPdfFilename("kent_wo.pdf")).toBe(true);
      expect(isSignedPdfFilename("workorder_kent.pdf")).toBe(true);
    });
  });

  describe("Should detect scan/photo PDFs", () => {
    it("should detect 'scan' in filename", () => {
      expect(isSignedPdfFilename("wo_scan.pdf")).toBe(true);
      expect(isSignedPdfFilename("scanned_document.pdf")).toBe(true);
      expect(isSignedPdfFilename("scan_001.pdf")).toBe(true);
    });

    it("should detect 'scanned' in filename", () => {
      expect(isSignedPdfFilename("wo_scanned.pdf")).toBe(true);
      expect(isSignedPdfFilename("scanned_copy.pdf")).toBe(true);
    });

    it("should detect 'phone' in filename", () => {
      expect(isSignedPdfFilename("wo_phone.pdf")).toBe(true);
      expect(isSignedPdfFilename("phone_photo.pdf")).toBe(true);
    });

    it("should detect 'mobile' in filename", () => {
      expect(isSignedPdfFilename("wo_mobile.pdf")).toBe(true);
      expect(isSignedPdfFilename("mobile_scan.pdf")).toBe(true);
    });

    it("should detect 'camera' in filename", () => {
      expect(isSignedPdfFilename("wo_camera.pdf")).toBe(true);
      expect(isSignedPdfFilename("camera_photo.pdf")).toBe(true);
    });

    it("should detect 'photo' in filename", () => {
      expect(isSignedPdfFilename("wo_photo.pdf")).toBe(true);
      expect(isSignedPdfFilename("photo_scan.pdf")).toBe(true);
      expect(isSignedPdfFilename("photo_scan_001.pdf")).toBe(true);
    });

    it("should detect 'image' in filename", () => {
      expect(isSignedPdfFilename("wo_image.pdf")).toBe(true);
      expect(isSignedPdfFilename("image_scan.pdf")).toBe(true);
    });

    it("should detect 'picture' in filename", () => {
      expect(isSignedPdfFilename("wo_picture.pdf")).toBe(true);
      expect(isSignedPdfFilename("picture_scan.pdf")).toBe(true);
    });

    it("should detect 'screenshot' in filename", () => {
      expect(isSignedPdfFilename("wo_screenshot.pdf")).toBe(true);
      expect(isSignedPdfFilename("screenshot_001.pdf")).toBe(true);
    });

    it("should detect 'capture' in filename", () => {
      expect(isSignedPdfFilename("wo_capture.pdf")).toBe(true);
      expect(isSignedPdfFilename("capture_001.pdf")).toBe(true);
    });

    it("should detect 'img_' prefix", () => {
      expect(isSignedPdfFilename("img_001.pdf")).toBe(true);
      expect(isSignedPdfFilename("img_workorder.pdf")).toBe(true);
    });

    it("should detect 'dsc' prefix (camera naming)", () => {
      expect(isSignedPdfFilename("dsc001.pdf")).toBe(true);
      expect(isSignedPdfFilename("dsc_1234.pdf")).toBe(true);
    });

    it("should detect 'pict' prefix", () => {
      expect(isSignedPdfFilename("pict001.pdf")).toBe(true);
      expect(isSignedPdfFilename("pict_workorder.pdf")).toBe(true);
    });
  });

  describe("Filename normalization", () => {
    it("should normalize spaces to underscores", () => {
      expect(isSignedPdfFilename("work order signed.pdf")).toBe(true);
      expect(isSignedPdfFilename("photo scan.pdf")).toBe(true);
    });

    it("should normalize to lowercase", () => {
      expect(isSignedPdfFilename("WORKORDER_SIGNED.PDF")).toBe(true);
      expect(isSignedPdfFilename("PhotoScan.PDF")).toBe(true);
    });

    it("should remove special characters", () => {
      expect(isSignedPdfFilename("work-order-signed.pdf")).toBe(true);
      expect(isSignedPdfFilename("photo@scan#001.pdf")).toBe(true);
      expect(isSignedPdfFilename("wo_signed!@#$%^&*().pdf")).toBe(true);
    });

    it("should handle mixed case and special chars", () => {
      expect(isSignedPdfFilename("Work Order-Signed.pdf")).toBe(true);
      expect(isSignedPdfFilename("Photo Scan_001.PDF")).toBe(true);
    });
  });

  describe("Should accept clean filenames", () => {
    it("should accept standard work order filenames", () => {
      expect(isSignedPdfFilename("workorder.pdf")).toBe(false);
      expect(isSignedPdfFilename("wo_12345.pdf")).toBe(false);
      expect(isSignedPdfFilename("job_001.pdf")).toBe(false);
      expect(isSignedPdfFilename("invoice.pdf")).toBe(false);
    });

    it("should accept facility management system filenames", () => {
      expect(isSignedPdfFilename("superclean_wo_12345.pdf")).toBe(false);
      expect(isSignedPdfFilename("23rd_group_workorder.pdf")).toBe(false);
      expect(isSignedPdfFilename("fm_system_export.pdf")).toBe(false);
    });

    it("should accept generic PDF filenames", () => {
      expect(isSignedPdfFilename("document.pdf")).toBe(false);
      expect(isSignedPdfFilename("file_001.pdf")).toBe(false);
      expect(isSignedPdfFilename("report.pdf")).toBe(false);
    });

    it("should accept filenames with numbers only", () => {
      expect(isSignedPdfFilename("12345.pdf")).toBe(false);
      expect(isSignedPdfFilename("001.pdf")).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty filename", () => {
      expect(isSignedPdfFilename("")).toBe(false);
    });

    it("should handle filename with only extension", () => {
      expect(isSignedPdfFilename(".pdf")).toBe(false);
    });

    it("should handle very long filenames", () => {
      const longName = "a".repeat(200) + "_signed.pdf";
      expect(isSignedPdfFilename(longName)).toBe(true);
    });

    it("should handle multiple indicators (should still detect)", () => {
      expect(isSignedPdfFilename("signed_photo_scan.pdf")).toBe(true);
      expect(isSignedPdfFilename("completed_signed_final.pdf")).toBe(true);
    });

    it("should handle partial matches correctly", () => {
      // "signed" should match even if part of another word
      expect(isSignedPdfFilename("resigned.pdf")).toBe(true); // contains "signed"
      expect(isSignedPdfFilename("assigned.pdf")).toBe(true); // contains "signed"
    });

    it("should handle case-insensitive matching", () => {
      expect(isSignedPdfFilename("SIGNED.pdf")).toBe(true);
      expect(isSignedPdfFilename("Signed.pdf")).toBe(true);
      expect(isSignedPdfFilename("SiGnEd.pdf")).toBe(true);
    });
  });
});

