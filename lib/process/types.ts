/**
 * Process Access Layer - Shared Types
 * 
 * Common types for all processing operations.
 */

import type { PdfIntent } from "@/lib/pdf/intent";

/**
 * PDF buffer or File input (flexible for client/server)
 */
export type PdfInput = Buffer | File;

/**
 * Convert PdfInput to Buffer (handles both Buffer and File)
 */
export async function pdfInputToBuffer(input: PdfInput): Promise<Buffer> {
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (input instanceof File) {
    const arrayBuffer = await input.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  throw new Error("Invalid PDF input: must be Buffer or File");
}

/**
 * Region points in PDF coordinate system
 */
export interface RegionPoints {
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  pageWidthPt: number;
  pageHeightPt: number;
}

