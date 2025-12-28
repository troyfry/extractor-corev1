/**
 * Dev-only OCR smoke test endpoint.
 * 
 * Accepts a PDF upload and template crop parameters, calls OCR service directly,
 * and returns the OCR JSON response without any other pipeline logic.
 * 
 * This is useful for validating cropping accuracy without the full processing pipeline.
 */

import { NextRequest, NextResponse } from "next/server";
import { callSignedOcrService } from "@/lib/workOrders/signedOcr";
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

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Call OCR service directly
    const result = await callSignedOcrService(
      pdfBuffer,
      file.name,
      {
        templateId,
        page,
        region: null, // Points mode - no region
        dpi,
        xPt,
        yPt,
        wPt,
        hPt,
        pageWidthPt,
        pageHeightPt,
      }
    );

    // Return OCR result directly
    return NextResponse.json({
      success: true,
      ocrResult: result,
      input: {
        templateId,
        page,
        dpi,
        crop: {
          xPt,
          yPt,
          wPt,
          hPt,
        },
        pageSize: {
          pageWidthPt,
          pageHeightPt,
        },
        filename: file.name,
        fileSize: pdfBuffer.length,
      },
    });
  } catch (error) {
    console.error("[OCR Smoke Test] Error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

