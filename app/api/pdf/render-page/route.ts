/**
 * API route to render a PDF page to PNG using MuPDF.
 * 
 * POST /api/pdf/render-page
 * Body: multipart/form-data with:
 *   - pdf: File (PDF file)
 *   - page: number (1-based page number)
 * 
 * Returns: { pngDataUrl, widthPx, heightPx, boundsPt: { x0, y0, x1, y1 }, pageWidthPt, pageHeightPt }
 */

import { NextResponse } from "next/server";
import { renderPdfPageToPng } from "@/lib/pdf/renderPdfPage";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("pdf");
    const pageRaw = form.get("page");
    const skipNormalization = form.get("skipNormalization") === "true"; // For template capture

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const page = Number(pageRaw || 1);
    if (!Number.isFinite(page) || page < 1) {
      return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    
    // ⚠️ DO NOT normalize PDFs for template capture - template capture needs original coordinates
    // Normalization is only for signed PDF processing (OCR/matching)
    // Template capture must use the original PDF to ensure accurate coordinate mapping
    if (skipNormalization) {
      console.log("[PDF Render API] Skipping normalization (template capture):", {
        filename: file.name,
        size: pdfBuffer.length,
      });
    }

    const out = await renderPdfPageToPng(pdfBuffer, page);

    // Return geometry matching the rendered image
    // - boundsPt: PDF box bounds (CropBox if available, else MediaBox)
    // - pageWidthPt/pageHeightPt: dimensions of the PDF box
    // - widthPx/heightPx: actual rendered image pixel dimensions (renderPx)
    return NextResponse.json({
      pngDataUrl: `data:image/png;base64,${out.pngBase64}`,
      widthPx: out.width,  // renderPx.width - actual rendered image dimensions
      heightPx: out.height, // renderPx.height - actual rendered image dimensions
      boundsPt: out.boundsPt, // PDF box bounds (CropBox if available, else MediaBox)
      pageWidthPt: out.pageWidthPt, // PDF box width in points
      pageHeightPt: out.pageHeightPt, // PDF box height in points
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

