import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Get PDF information (page count) and optionally render a specific page.
 * POST /api/pdf/info
 * Body: FormData with:
 *   - file: PDF file
 *   - page?: number (optional, if provided, renders that page)
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

    const pageParam = formData.get("page");
    const pageToRender = pageParam ? parseInt(String(pageParam), 10) : null;

    const result: {
      pageCount: number;
      pageImage?: string | null;
      pageWidth?: number | null;
      pageHeight?: number | null;
    } = {
      pageCount,
    };

    // If a specific page is requested, return stubbed response
    if (pageToRender !== null && !isNaN(pageToRender)) {
      if (pageToRender < 1 || pageToRender > pageCount) {
        return NextResponse.json(
          { error: `Page ${pageToRender} is out of range. Document has ${pageCount} page(s).` },
          { status: 400 }
        );
      }

      // TODO: MuPDF WASM is failing in Next.js serverless environment with '_ is not a function' error.
      // This appears to be a compatibility issue between mupdf's WASM bindings and Next.js.
      // Future options:
      // 1. Replace with a Python-based PDF renderer (e.g., via a microservice)
      // 2. Use a client-side PDF viewer (e.g., pdf.js in the browser)
      // 3. Use a different server-side PDF rendering library compatible with Next.js
      // 
      // For now, return null values so the route doesn't throw and the UI can still function
      // (signed-processing and Needs_Review logic will continue to work)
      result.pageImage = null;
      result.pageWidth = null;
      result.pageHeight = null;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[PDF Info] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process PDF" },
      { status: 500 }
    );
  }
}

