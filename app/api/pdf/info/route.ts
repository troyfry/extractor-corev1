import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Get PDF information (page count only).
 * PDF rendering is done client-side using pdfjs-dist in the browser.
 * POST /api/pdf/info
 * Body: FormData with:
 *   - file: PDF file
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No PDF file provided." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Validate PDF header
    const header = pdfBuffer.subarray(0, 5).toString("utf8");
    if (header !== "%PDF-") {
      return NextResponse.json(
        { error: "Invalid PDF file format." },
        { status: 400 }
      );
    }

    // Get page count using pdf-parse
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse");
    const parseFn = typeof pdfParse === "function" ? pdfParse : pdfParse.default ?? pdfParse;
    const data = await parseFn(pdfBuffer);
    const pageCount = data.numpages || 1;

    // This endpoint only returns page count
    // PDF rendering is done client-side using pdfjs-dist in the browser
    return NextResponse.json({
      pageCount,
    });
  } catch (error) {
    console.error("[PDF Info] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process PDF" },
      { status: 500 }
    );
  }
}

