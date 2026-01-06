/**
 * API route to render a PDF page to PNG using MuPDF.
 * 
 * POST /api/pdf/render-page
 * Body: multipart/form-data with:
 *   - pdf: File (PDF file) - required
 *   - page: number (1-based page number) - required
 *   - OPTIONAL: intent (string) - "TEMPLATE_CAPTURE" | "SIGNED_PROCESSING" | "GENERAL_VIEW"
 *   - OPTIONAL: allowRaster (string "true"/"false") - default false for TEMPLATE_CAPTURE, true otherwise
 *   - OPTIONAL: skipNormalization (string "true"/"false") - legacy flag, honored if intent missing
 * 
 * Returns: { pngDataUrl, widthPx, heightPx, boundsPt: { x0, y0, x1, y1 }, pageWidthPt, pageHeightPt, page, totalPages }
 * 
 * Intent-based behavior:
 * - TEMPLATE_CAPTURE: normalize=false, block raster-only PDFs (unless allowRaster=true)
 * - SIGNED_PROCESSING: normalize=true (unless skipNormalization=true), allowRaster=true
 * - GENERAL_VIEW or missing: backwards compatible (honor skipNormalization flag)
 */

import { NextResponse } from "next/server";
import { renderPdfPage } from "@/lib/process";
import { parsePdfIntent } from "@/lib/pdf/intent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("pdf");
    const pageRaw = form.get("page");
    const intentRaw = form.get("intent");
    const allowRasterRaw = form.get("allowRaster");
    const skipNormalizationRaw = form.get("skipNormalization");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const page = Number(pageRaw || 1);
    if (!Number.isFinite(page) || page < 1) {
      return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    }

    // Parse intent and flags
    const intent = parsePdfIntent(intentRaw);
    const allowRaster = allowRasterRaw === "true";
    const skipNormalization = skipNormalizationRaw === "true";

    // Use process layer to render PDF page
    const out = await renderPdfPage({
      pdf: file,
      page,
      intent: intent ?? undefined,
      allowRaster: allowRaster || undefined,
      skipNormalization: skipNormalization || undefined,
    });

    // Return geometry matching the rendered image
    // - boundsPt: PDF box bounds (CropBox if available, else MediaBox) - all real numbers
    // - pageWidthPt/pageHeightPt: dimensions of the PDF box - computed from bounds
    // - widthPx/heightPx: actual rendered image pixel dimensions - from pixmap
    // - pngDataUrl: full data URL for the rendered image
    // - page: the page number that was rendered (1-indexed)
    // - totalPages: total number of pages in the PDF document
    return NextResponse.json({
      pngDataUrl: out.pngDataUrl, // Full data URL (data:image/png;base64,...)
      widthPx: out.widthPx, // Actual rendered image width in pixels
      heightPx: out.heightPx, // Actual rendered image height in pixels
      boundsPt: out.boundsPt, // PDF box bounds (CropBox if available, else MediaBox)
      pageWidthPt: out.pageWidthPt, // PDF box width in points
      pageHeightPt: out.pageHeightPt, // PDF box height in points
      page: out.page, // Current page number (1-indexed)
      totalPages: out.totalPages, // Total number of pages in the PDF
    });
  } catch (error) {
    console.error("[PDF Render API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to render PDF page";
    
    // Check if it's a MuPDF module error and provide helpful guidance
    const isMupdfError = errorMessage.includes("mupdf") || 
                        errorMessage.includes("MuPDF") ||
                        errorMessage.includes("Cannot find module 'mupdf'");
    
    if (isMupdfError) {
      return NextResponse.json(
        { 
          error: "PDF rendering requires the MuPDF module to be installed. " +
                 "Please install it by running: pnpm add mupdf " +
                 "or contact your administrator to install the required dependencies."
        },
        { status: 503 } // Service Unavailable - dependency missing
      );
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

