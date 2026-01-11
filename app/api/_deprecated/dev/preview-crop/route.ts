/**
 * Dev-only preview crop endpoint.
 * 
 * Calls Python /v1/ocr/preview-crop to visualize the crop zone
 * using saved template points. Returns the PNG image directly.
 * 
 * This is useful for verifying crops before running OCR.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getTemplateConfigForFmKey } from "@/lib/workOrders/templateConfig";

export const runtime = "nodejs";

function getSignedOcrServiceBaseUrl(): string {
  const baseUrl = process.env.SIGNED_OCR_SERVICE_URL;
  if (!baseUrl) {
    throw new Error(
      "SIGNED_OCR_SERVICE_URL is not set. Point this to your FastAPI OCR service base URL."
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

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
    const fmKey = formData.get("fmKey") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "Missing 'file' field" },
        { status: 400 }
      );
    }

    if (!fmKey) {
      return NextResponse.json(
        { error: "Missing 'fmKey' field" },
        { status: 400 }
      );
    }

    // Get template config for this fmKey
    let templateConfig;
    try {
      templateConfig = await getTemplateConfigForFmKey(fmKey);
    } catch (error) {
      return NextResponse.json(
        { error: `Template not found for fmKey: ${fmKey}` },
        { status: 404 }
      );
    }

    // Validate template has PDF points
    if (!templateConfig.xPt || !templateConfig.yPt || !templateConfig.wPt || !templateConfig.hPt ||
        !templateConfig.pageWidthPt || !templateConfig.pageHeightPt) {
      return NextResponse.json(
        { error: "Template does not have PDF points configured" },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Call Python preview-crop endpoint
    const baseUrl = getSignedOcrServiceBaseUrl();
    const endpoint = `${baseUrl}/v1/ocr/preview-crop`;

    const pythonFormData = new FormData();
    pythonFormData.append("templateId", templateConfig.templateId);
    pythonFormData.append("page", String(templateConfig.page));
    pythonFormData.append("dpi", String(templateConfig.dpi ?? 200));
    pythonFormData.append("xPt", String(templateConfig.xPt));
    pythonFormData.append("yPt", String(templateConfig.yPt));
    pythonFormData.append("wPt", String(templateConfig.wPt));
    pythonFormData.append("hPt", String(templateConfig.hPt));
    pythonFormData.append("pageWidthPt", String(templateConfig.pageWidthPt));
    pythonFormData.append("pageHeightPt", String(templateConfig.pageHeightPt));
    pythonFormData.append(
      "file",
      new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
      file.name
    );

    const response = await fetch(endpoint, {
      method: "POST",
      body: pythonFormData,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[Preview Crop] Error response:", text);
      return NextResponse.json(
        {
          error: "Preview crop service failed",
          message: text,
        },
        { status: response.status }
      );
    }

    // Python should return PNG image
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.startsWith("image/")) {
      const imageBuffer = await response.arrayBuffer();
      return new NextResponse(imageBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
        },
      });
    } else {
      // If not an image, return as JSON (error case)
      const text = await response.text();
      return NextResponse.json(
        {
          error: "Unexpected response format",
          response: text,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[Preview Crop] Error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

