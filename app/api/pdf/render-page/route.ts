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
import { normalizePdfBuffer } from "@/lib/pdf/normalizePdf";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("pdf");
    const pageRaw = form.get("page");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const page = Number(pageRaw || 1);
    if (!Number.isFinite(page) || page < 1) {
      return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    }

    const originalBuf = Buffer.from(await file.arrayBuffer());
    
    // Normalize PDF before rendering (fixes coordinate systems and bounds)
    console.log("[PDF Render API] Normalizing PDF before rendering:", {
      filename: file.name,
      originalSize: originalBuf.length,
    });
    
    const normalizedBuf = await normalizePdfBuffer(originalBuf);
    
    if (normalizedBuf !== originalBuf) {
      console.log("[PDF Render API] PDF was normalized:", {
        filename: file.name,
        originalSize: originalBuf.length,
        normalizedSize: normalizedBuf.length,
      });
    }

    const out = await renderPdfPageToPng(normalizedBuf, page);

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
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

