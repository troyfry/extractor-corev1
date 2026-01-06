/**
 * API route to detect if a PDF is raster/scan-only (no text layer).
 * 
 * POST /api/pdf/detect-raster
 * Body: multipart/form-data with:
 *   - pdf: File (PDF file)
 * 
 * Returns: { isRasterOnly: boolean }
 */

import { NextResponse } from "next/server";
import { detectRasterOnlyPdf } from "@/lib/process";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("pdf");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const result = await detectRasterOnlyPdf({ pdf: file });

    return NextResponse.json({ isRasterOnly: result.isRasterOnly });
  } catch (error) {
    console.error("[PDF Detect Raster] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to detect raster PDF";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

