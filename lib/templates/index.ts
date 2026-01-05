/**
 * Template Domain Layer
 * 
 * This is the single source of truth for template operations.
 * UI and routes must use these functions - no direct template parsing logic.
 */

import { getTemplateByFmKey, type Template } from "@/lib/templates/templatesSheets";
import { normalizeRegion, validateRegion, type TemplateRegion, type RawTemplateRegion } from "./regions";
import { extractPdfJsPageDimensions } from "./pdfJsUtils";

/**
 * Get a template by templateId (or fmKey).
 * Returns the template from storage, or null if not found.
 */
export async function getTemplate(
  templateId: string,
  options?: {
    accessToken: string;
    spreadsheetId: string;
    userId: string;
  }
): Promise<Template | null> {
  if (!options) {
    // If no options provided, this function cannot fetch from storage
    // Return null - caller should use getTemplateByFmKey directly with auth
    return null;
  }

  // For now, templateId is typically the same as fmKey
  // In the future, we might have separate templateId lookup
  return getTemplateByFmKey(
    options.accessToken,
    options.spreadsheetId,
    options.userId,
    templateId
  );
}

/**
 * Validate a template region.
 * Throws if validation fails.
 */
export function validateTemplateRegion(region: RawTemplateRegion): void {
  validateRegion(region);
}

/**
 * Normalize a template region to canonical format.
 * Validates and normalizes the region data.
 */
export function normalizeTemplateRegion(region: RawTemplateRegion): TemplateRegion {
  return normalizeRegion(region);
}

/**
 * Get expected page dimensions for a template.
 * Returns pageWidthPt and pageHeightPt from the stored template.
 */
export async function getExpectedPageDims(
  templateId: string,
  options?: {
    accessToken: string;
    spreadsheetId: string;
    userId: string;
  }
): Promise<{ pageWidthPt: number; pageHeightPt: number } | null> {
  const template = await getTemplate(templateId, options);
  
  if (!template) {
    return null;
  }

  if (!template.pageWidthPt || !template.pageHeightPt) {
    return null;
  }

  return {
    pageWidthPt: template.pageWidthPt,
    pageHeightPt: template.pageHeightPt,
  };
}

/**
 * Normalize coordinate system string.
 * Re-exports from regions module for convenience.
 */
export { normalizeCoordSystem, isTemplateRegion } from "./regions";
export { extractPdfJsPageDimensions } from "./pdfJsUtils";

/**
 * Type exports
 */
export type { TemplateRegion, RawTemplateRegion } from "./regions";
export type { Template } from "@/lib/templates/templatesSheets";

/**
 * Detect if a PDF is raster/scan-only (image-based, not digital).
 * Returns true if PDF appears to be scanned/image-based.
 * 
 * This is used as a guardrail to prevent template capture on scanned PDFs.
 * 
 * Detection strategy for scanned PDFs (which may have OCR'd text):
 * 1. Check PDF structure for image objects vs vector content
 * 2. Analyze file size relative to text content (scanned PDFs are larger)
 * 3. Check PDF metadata for scanning software indicators
 * 4. Look for patterns indicating image-based content
 */
export async function detectRasterOnlyPdf(pdfBuffer: Buffer): Promise<boolean> {
  try {
    // pdf-parse is CommonJS and must be required (not imported)
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const parseFn =
      typeof pdfParse === "function" ? pdfParse : pdfParse.default ?? pdfParse;

    const data = await parseFn(pdfBuffer);
    const text = (data?.text ?? "").trim();
    
    // If no text at all, definitely raster-only
    if (!text || text.length === 0) {
      return true;
    }
    
    // Check file size relative to text content
    // Scanned PDFs are typically much larger due to embedded images
    const fileSizeKB = pdfBuffer.length / 1024;
    const textLength = text.length;
    const bytesPerChar = fileSizeKB * 1024 / textLength;
    
    // Digital PDFs: typically < 50 bytes per character (vector text is efficient)
    // Scanned PDFs: typically > 200 bytes per character (images are large)
    // Threshold: if > 150 bytes per character, likely scanned
    if (bytesPerChar > 150) {
      console.log("[Template Domain] PDF has high bytes-per-character ratio, likely scanned:", {
        fileSizeKB: Math.round(fileSizeKB * 10) / 10,
        textLength,
        bytesPerChar: Math.round(bytesPerChar * 10) / 10,
        threshold: 150,
      });
      return true;
    }
    
    // Check PDF metadata for scanning software indicators
    const info = data.info || {};
    const producer = (info.Producer || "").toLowerCase();
    const creator = (info.Creator || "").toLowerCase();
    const title = (info.Title || "").toLowerCase();
    
    const scanIndicators = [
      "scanner",
      "scan",
      "adobe acrobat", // Often used for scanning
      "adobe distiller", // Often used for scanned PDFs
      "tesseract", // OCR software
      "ocr",
      "image",
      "camera",
      "mobile",
      "phone",
    ];
    
    const metadataText = `${producer} ${creator} ${title}`;
    const hasScanIndicator = scanIndicators.some(indicator => 
      metadataText.includes(indicator)
    );
    
    if (hasScanIndicator) {
      console.log("[Template Domain] PDF metadata indicates scanning software:", {
        producer: info.Producer,
        creator: info.Creator,
        title: info.Title,
      });
      return true;
    }
    
    // Check for very large file size with minimal text (strong indicator of scanned PDF)
    // Files > 1MB with < 1000 characters are likely scanned
    if (fileSizeKB > 1000 && textLength < 1000) {
      console.log("[Template Domain] PDF is very large with minimal text, likely scanned:", {
        fileSizeKB: Math.round(fileSizeKB * 10) / 10,
        textLength,
      });
      return true;
    }
    
    // Additional check: Look for PDF structure patterns
    // Scanned PDFs often have specific patterns in the raw PDF content
    const pdfString = pdfBuffer.toString("binary", 0, Math.min(5000, pdfBuffer.length));
    const hasImageObjects = /\/Type\s*\/XObject[\s\S]*?\/Subtype\s*\/Image/gi.test(pdfString);
    const hasImageStreams = /\/Filter\s*\/[Dd]CT[DE]code|JPXDecode|JBIG2Decode/gi.test(pdfString);
    
    // If PDF has many image objects/streams and high bytes-per-char, likely scanned
    if ((hasImageObjects || hasImageStreams) && bytesPerChar > 100) {
      console.log("[Template Domain] PDF has image objects/streams with high bytes-per-char, likely scanned:", {
        hasImageObjects,
        hasImageStreams,
        bytesPerChar: Math.round(bytesPerChar * 10) / 10,
      });
      return true;
    }
    
    // Passed all checks - likely digital PDF
    return false;
  } catch (error) {
    // If extraction throws "EMPTY_TEXT_FROM_PDF", it's raster-only
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("EMPTY_TEXT_FROM_PDF") || 
        errorMessage.includes("empty") ||
        errorMessage.includes("no extractable text")) {
      return true;
    }
    
    // Other errors - be conservative and assume scanned to prevent bad uploads
    console.warn("[Template Domain] Error detecting raster PDF, assuming scanned (conservative):", errorMessage);
    return true; // Changed to true - be conservative
  }
}

/**
 * Check if debug flag allows overriding raster-only PDF restriction.
 * Controlled by environment variable: TEMPLATE_ALLOW_RASTER_OVERRIDE=true
 */
export function canOverrideRasterRestriction(): boolean {
  return process.env.TEMPLATE_ALLOW_RASTER_OVERRIDE === "true";
}

/**
 * Check if a filename indicates a signed/scan PDF.
 * Returns true if the filename contains indicators of a signed or scanned document.
 */
export function isSignedPdfFilename(filename: string): boolean {
  // Normalize filename: lowercase, spaces to underscores, remove special chars
  const fileNameLower = filename
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\.]/g, "");
  
  const signedIndicators = [
    "signed",
    "signoff",
    "sign",
    "signature",
    "completed",
    "final",
    "executed",
    "proof",
    "kent", // Test files often include this
    "photo_scan",
    "scan_",
    "signed_",
    "scan",
    "scanned",
    "phone",
    "mobile",
    "camera",
    "photo",
    "image",
    "picture",
    "screenshot",
    "capture",
    "img_",
    "dsc",
    "pict",
  ];
  
  return signedIndicators.some(indicator => fileNameLower.includes(indicator));
}

/**
 * Re-export page dimension validation from client-safe module.
 * 
 * Note: Client components should import directly from @/lib/templates/pageDimensions
 * to avoid bundling server-side dependencies. This re-export is for server-side code.
 */
export { STANDARD_PAGE_SIZES, validatePageDimensions } from "./pageDimensions";

/**
 * Validate that a PDF is suitable for template capture.
 * Throws if PDF is raster-only and override is not enabled, or if filename indicates signed/scan.
 * 
 * @param pdfBuffer - PDF file buffer (optional if only validating filename)
 * @param options - Validation options including filename and override flags
 */
export async function validatePdfForTemplateCapture(
  pdfBuffer: Buffer | undefined,
  options?: {
    filename?: string;
    allowRasterOverride?: boolean;
  }
): Promise<{ isRasterOnly: boolean; allowed: boolean }> {
  // Step 1: Validate filename if provided
  if (options?.filename) {
    if (isSignedPdfFilename(options.filename)) {
      throw new Error(
        "Signed scans cannot be used for template capture. " +
        "Please upload the original digital work order PDF (the PDF file you received from the facility management system, not a phone scan or signed copy)."
      );
    }
  }

  // Step 2: Validate PDF buffer if provided
  if (!pdfBuffer) {
    // If no buffer provided, only filename validation was performed
    return { isRasterOnly: false, allowed: true };
  }

  const isRasterOnly = await detectRasterOnlyPdf(pdfBuffer);
  
  if (!isRasterOnly) {
    return { isRasterOnly: false, allowed: true };
  }

  // Raster-only PDF detected
  const overrideAllowed = options?.allowRasterOverride ?? canOverrideRasterRestriction();
  
  if (!overrideAllowed) {
    throw new Error(
      "Template capture requires a digital PDF with text content. " +
      "This PDF appears to be raster/scan-only (no text layer). " +
      "Please use the original digital work order PDF from your facility management system."
    );
  }

  // Override allowed (debug flag)
  console.warn("[Template Domain] Raster-only PDF allowed due to override flag");
  return { isRasterOnly: true, allowed: true };
}

