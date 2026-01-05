/**
 * API route to normalize PDF using Python OCR service.
 * 
 * POST /api/pdf/normalize
 * Body: multipart/form-data with:
 *   - pdf: File (PDF file)
 * 
 * Returns: Normalized PDF buffer (or original if normalization fails/not available)
 */

import { NextResponse } from "next/server";

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

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("pdf");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing PDF file" }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const originalSize = pdfBuffer.length;

    console.log("🔧 [NORMALIZATION] Starting PDF normalization:", {
      filename: file.name,
      originalSize,
      method: "MuPDF (Python service normalizes during OCR, not file normalization)",
      timestamp: new Date().toISOString(),
    });

    // Python OCR service doesn't have a separate normalization endpoint.
    // Normalization happens automatically during OCR when pageWidthPt/pageHeightPt are provided.
    // For file normalization (to upload normalized PDF to Drive), we use MuPDF.
    // Import MuPDF normalization function
    try {
      const { normalizePdfBuffer } = await import("@/lib/pdf/normalizePdf");
      
      const normalizedBuffer = await normalizePdfBuffer(pdfBuffer);
      const normalizedSize = normalizedBuffer.length;
      
      if (normalizedBuffer !== pdfBuffer) {
        console.log("✅ [NORMALIZATION] PDF NORMALIZED SUCCESSFULLY via MuPDF:", {
          filename: file.name,
          originalSize,
          normalizedSize,
          sizeChange: normalizedSize - originalSize,
          timestamp: new Date().toISOString(),
        });
        
        // Return normalized PDF as binary (convert Buffer to Uint8Array for NextResponse)
        return new NextResponse(new Uint8Array(normalizedBuffer), {
          headers: {
            "Content-Type": "application/pdf",
          },
        });
      } else {
        console.log("ℹ️ [NORMALIZATION] PDF did not require normalization (already normalized or no non-zero bounds):", {
          filename: file.name,
          size: originalSize,
          timestamp: new Date().toISOString(),
        });
        
        // Return original PDF (already normalized or doesn't need normalization)
        return new NextResponse(new Uint8Array(pdfBuffer), {
          headers: {
            "Content-Type": "application/pdf",
          },
        });
      }
    } catch (error) {
      // If normalization fails, return original PDF (fail gracefully)
      console.warn("⚠️ [NORMALIZATION] Error during MuPDF normalization, using original PDF:", {
        filename: file.name,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
        },
      });
    }
  } catch (error) {
    console.error("[PDF Normalize API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to normalize PDF";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

