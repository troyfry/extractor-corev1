/**
 * Test Extract API route - proxies OCR requests for template capture validation.
 * 
 * This endpoint allows users to test crop zones before saving templates by
 * running OCR on the selected region. It proxies requests to the external
 * FastAPI OCR service.
 * 
 * POST /api/ocr/test-extract
 *   Body: FormData with:
 *     - file: PDF file
 *     - templateId: template identifier
 *     - page: page number (1-based)
 *     - dpi: DPI for rendering (default 200)
 *     - xPt, yPt, wPt, hPt: crop region in PDF points
 *     - pageWidthPt, pageHeightPt: page dimensions in PDF points
 *   Response: OCR result with workOrderNumber, confidence, rawText, snippetImageUrl
 */

import { NextRequest, NextResponse } from "next/server";
import { ocrWorkOrderNumberFromUpload } from "@/lib/_deprecated/process";
import { getCurrentUser } from "@/lib/auth/currentUser";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const user = await getCurrentUser();
    if (!user || !user.userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json(
        { error: "Missing 'file' field" },
        { status: 400 }
      );
    }

    // Get template parameters
    const templateId = formData.get("templateId") as string | null;
    const pageStr = formData.get("page") as string | null;
    const dpiStr = formData.get("dpi") as string | null;
    
    // Get PDF points (required)
    const xPtStr = formData.get("xPt") as string | null;
    const yPtStr = formData.get("yPt") as string | null;
    const wPtStr = formData.get("wPt") as string | null;
    const hPtStr = formData.get("hPt") as string | null;
    const pageWidthPtStr = formData.get("pageWidthPt") as string | null;
    const pageHeightPtStr = formData.get("pageHeightPt") as string | null;

    // Validate required fields
    if (!templateId || !pageStr || !xPtStr || !yPtStr || !wPtStr || !hPtStr || !pageWidthPtStr || !pageHeightPtStr) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          required: [
            "templateId",
            "page",
            "xPt",
            "yPt",
            "wPt",
            "hPt",
            "pageWidthPt",
            "pageHeightPt",
          ],
        },
        { status: 400 }
      );
    }

    // Parse numeric values
    const page = parseInt(pageStr, 10);
    const dpi = dpiStr ? parseInt(dpiStr, 10) : 200;
    const xPt = parseFloat(xPtStr);
    const yPt = parseFloat(yPtStr);
    const wPt = parseFloat(wPtStr);
    const hPt = parseFloat(hPtStr);
    const pageWidthPt = parseFloat(pageWidthPtStr);
    const pageHeightPt = parseFloat(pageHeightPtStr);

    // Validate numeric values
    if (
      isNaN(page) || page < 1 ||
      isNaN(dpi) || dpi < 100 || dpi > 400 ||
      isNaN(xPt) || isNaN(yPt) || isNaN(wPt) || isNaN(hPt) ||
      isNaN(pageWidthPt) || isNaN(pageHeightPt) ||
      wPt <= 0 || hPt <= 0 || pageWidthPt <= 0 || pageHeightPt <= 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid numeric values",
          values: {
            page,
            dpi,
            xPt,
            yPt,
            wPt,
            hPt,
            pageWidthPt,
            pageHeightPt,
          },
        },
        { status: 400 }
      );
    }

    // Use process layer to call OCR service
    const result = await ocrWorkOrderNumberFromUpload({
      pdf: file,
      fmKey: templateId,
      page,
      dpi,
      regionPoints: {
        xPt,
        yPt,
        wPt,
        hPt,
        pageWidthPt,
        pageHeightPt,
      },
    });

    // Return OCR result in format expected by client
    return NextResponse.json({
      workOrderNumber: result.workOrderNumber,
      woNumber: result.workOrderNumber,
      extractedText: result.rawText,
      rawText: result.rawText,
      confidence: result.confidence,
      confidenceRaw: result.confidence,
      confidenceLabel: result.confidence ? (result.confidence >= 0.9 ? "high" : result.confidence >= 0.6 ? "medium" : "low") : undefined,
      snippetImageUrl: result.snippetImageUrl,
    });
  } catch (error) {
    console.error("[Test Extract] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to test extract",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

