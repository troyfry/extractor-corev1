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

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const page = Number(pageRaw || 1);
    if (!Number.isFinite(page) || page < 1) {
      return NextResponse.json({ error: "Invalid page" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    const out = await renderPdfPageToPng(buf, page);

    return NextResponse.json({
      pngDataUrl: `data:image/png;base64,${out.pngBase64}`,
      widthPx: out.width,
      heightPx: out.height,
      boundsPt: out.boundsPt,
      pageWidthPt: out.pageWidthPt,
      pageHeightPt: out.pageHeightPt,
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

