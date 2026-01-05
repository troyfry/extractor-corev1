/**
 * PDF normalization using Python OCR service.
 * 
 * Normalizes PDF files by calling the Python OCR service to fix coordinate systems and bounds.
 * This ensures all PDFs have consistent coordinate systems (0-based origin) before template capture.
 */

function getSignedOcrServiceBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_SIGNED_OCR_SERVICE_URL || process.env.SIGNED_OCR_SERVICE_URL;
  if (!baseUrl) {
    throw new Error(
      "SIGNED_OCR_SERVICE_URL or NEXT_PUBLIC_SIGNED_OCR_SERVICE_URL is not set. Point this to your FastAPI OCR service base URL."
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Get PDF page dimensions from Python OCR service.
 * 
 * @param pdfBuffer PDF buffer
 * @param page Page number (1-based)
 * @returns Page dimensions in points, or null if failed
 */
export async function getPdfPageDimensionsFromPython(
  pdfBuffer: Buffer,
  page: number
): Promise<{ widthPt: number; heightPt: number; totalPages: number } | null> {
  try {
    const baseUrl = getSignedOcrServiceBaseUrl();
    
    // Create a temporary data URL for the PDF
    const pdfBase64 = pdfBuffer.toString("base64");
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;
    
    // Call Python service page-dimensions endpoint
    const response = await fetch(
      `${baseUrl}/v1/pdf/page-dimensions?pdfUrl=${encodeURIComponent(pdfDataUrl)}&page=${page}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.warn("[Normalize PDF Python] Failed to get page dimensions:", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const data = await response.json();
    
    if (data.widthPt && data.heightPt) {
      return {
        widthPt: parseFloat(data.widthPt),
        heightPt: parseFloat(data.heightPt),
        totalPages: data.totalPages || 1,
      };
    }

    return null;
  } catch (error) {
    console.warn("[Normalize PDF Python] Error getting page dimensions:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Normalize PDF using Python OCR service.
 * 
 * This function calls the Python OCR service to normalize the PDF (fix coordinate systems and bounds).
 * If normalization endpoint doesn't exist, returns the original buffer.
 * 
 * @param pdfBuffer Original PDF buffer
 * @returns Normalized PDF buffer, or original buffer if normalization fails or isn't available
 */
export async function normalizePdfBufferPython(
  pdfBuffer: Buffer
): Promise<Buffer> {
  try {
    const baseUrl = getSignedOcrServiceBaseUrl();
    
    // Check if normalization endpoint exists by trying to call it
    // The Python service might have a /v1/pdf/normalize endpoint
    const normalizeEndpoint = `${baseUrl}/v1/pdf/normalize`;
    
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
      "normalize.pdf"
    );

    const response = await fetch(normalizeEndpoint, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      // Normalization endpoint might not exist - that's okay, return original
      console.log("[Normalize PDF Python] Normalization endpoint not available, using original PDF");
      return pdfBuffer;
    }

    // Get normalized PDF from response
    const normalizedArrayBuffer = await response.arrayBuffer();
    const normalizedBuffer = Buffer.from(normalizedArrayBuffer);
    
    console.log("[Normalize PDF Python] PDF normalized successfully:", {
      originalSize: pdfBuffer.length,
      normalizedSize: normalizedBuffer.length,
    });
    
    return normalizedBuffer;
  } catch (error) {
    // If normalization fails, return original buffer (fail gracefully)
    console.warn("[Normalize PDF Python] Error during normalization, using original PDF:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return pdfBuffer;
  }
}

