export type SignedConfidenceLabel = "high" | "medium" | "low";

export type SignedOcrResult = {
  woNumber: string | null;
  rawText: string;
  confidenceLabel: SignedConfidenceLabel;
  confidenceRaw: number;
  snippetImageUrl: string | null;
};

export type TemplateRegion = {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
};

export type SignedOcrConfig = {
  templateId: string;
  page: number;
  region: TemplateRegion | null; // null when using PDF points mode (legacy support)
  dpi?: number;
  // PDF points fields (required when using PDF_POINTS_TOP_LEFT coordinate system)
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  requestId?: string; // Optional request ID for correlated logging
};

function getSignedOcrServiceBaseUrl(): string {
  const baseUrl = process.env.SIGNED_OCR_SERVICE_URL;
  if (!baseUrl) {
    throw new Error(
      "SIGNED_OCR_SERVICE_URL is not set. Point this to your FastAPI OCR service base URL."
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

function mapConfidenceToLabel(value: number | null | undefined): SignedConfidenceLabel {
  if (value == null || Number.isNaN(value)) return "low";
  // High (>= 0.9): Clear match with image - auto-update
  // Medium (>= 0.6): Somewhat reliable - auto-update
  // Low (< 0.6): Needs manual review
  if (value >= 0.9) return "high";
  if (value >= 0.6) return "medium";
  return "low";
}

/**
 * Call the FastAPI OCR microservice /v1/ocr/workorder-number/upload
 * with the signed PDF and the template crop region.
 */
export async function callSignedOcrService(
  pdfBuffer: Buffer,
  filename: string,
  config: SignedOcrConfig
): Promise<SignedOcrResult> {
  const baseUrl = getSignedOcrServiceBaseUrl();
  const endpoint = `${baseUrl}/v1/ocr/workorder-number/upload`;

  // Hard guard: PDF_POINTS only - all points fields must exist
  if (config.xPt === undefined || config.yPt === undefined || 
      config.wPt === undefined || config.hPt === undefined ||
      config.pageWidthPt === undefined || config.pageHeightPt === undefined) {
    throw new Error(
      "PDF_POINTS format required: xPt, yPt, wPt, hPt, pageWidthPt, and pageHeightPt are all required. " +
      "Legacy percentage format is no longer supported."
    );
  }

  // Validate points are valid numbers
  const { xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt } = config;
  if (!Number.isFinite(xPt) || !Number.isFinite(yPt) || !Number.isFinite(wPt) || !Number.isFinite(hPt) ||
      !Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt)) {
    throw new Error("All PDF point fields must be finite numbers");
  }

  if (wPt <= 0 || hPt <= 0 || pageWidthPt <= 0 || pageHeightPt <= 0) {
    throw new Error("wPt, hPt, pageWidthPt, and pageHeightPt must be positive numbers");
  }

  if (config.page < 1) {
    throw new Error("page must be >= 1 (1-based)");
  }

  // Convert PDF points to pixels, clamp to image bounds, then convert back to points
  // This ensures the crop rectangle never exceeds image bounds
  const dpi = config.dpi ?? 200;
  const scale = dpi / 72;
  
  // Image dimensions in pixels
  const imageWidthPx = pageWidthPt * scale;
  const imageHeightPx = pageHeightPt * scale;
  
  // Convert points to pixels using direct formula: scale = dpi/72
  let xPx = xPt * scale;
  let yPx = yPt * scale;
  let wPx = wPt * scale;
  let hPx = hPt * scale;
  
  // Clamp crop rectangle to image bounds
  const clampedXPx = Math.max(0, Math.min(xPx, imageWidthPx));
  const clampedYPx = Math.max(0, Math.min(yPx, imageHeightPx));
  const clampedWPx = Math.max(0, Math.min(wPx, imageWidthPx - clampedXPx));
  const clampedHPx = Math.max(0, Math.min(hPx, imageHeightPx - clampedYPx));
  
  // Convert clamped pixels back to points
  const clampedXPt = clampedXPx / scale;
  const clampedYPt = clampedYPx / scale;
  const clampedWPt = clampedWPx / scale;
  const clampedHPt = clampedHPx / scale;
  
  // Coordinate origin conversion: Templates use PDF_POINTS_TOP_LEFT (y=0 at top)
  // Verify Python OCR service coordinate origin:
  // - If Python expects PDF_POINTS_TOP_LEFT (same as templates): no conversion needed
  // - If Python expects PDF_POINTS_BOTTOM_LEFT (y=0 at bottom): convert y using:
  //   yPtBottomLeft = pageHeightPt - (yPt + hPt)
  // Currently assuming top-left origin (matches templates)
  // TODO: Verify Python service coordinate system and uncomment conversion if needed:
  // const yPtForPython = pageHeightPt - (clampedYPt + clampedHPt);
  const finalXPt = clampedXPt;
  const finalYPt = clampedYPt;
  const finalWPt = clampedWPt;
  const finalHPt = clampedHPt;
  
  // Debug log with all conversion details
  console.log(`[Signed OCR] Points to pixels conversion (clamped):`, {
    requestId: config.requestId,
    dpi,
    pageWidthPt,
    pageHeightPt,
    inputPoints: { xPt, yPt, wPt, hPt },
    computedPixels: { xPx, yPx, wPx, hPx },
    clampedPixels: { xPx: clampedXPx, yPx: clampedYPx, wPx: clampedWPx, hPx: clampedHPx },
    finalPoints: { xPt: finalXPt, yPt: finalYPt, wPt: finalWPt, hPt: finalHPt },
    imageDimensions: { widthPx: imageWidthPx, heightPx: imageHeightPx },
    scale,
  });

  const formData = new FormData();
  formData.append("templateId", config.templateId);
  formData.append("page", String(config.page)); // must be 1-based
  formData.append("dpi", String(dpi));
  
  // Send clamped PDF points to Python (Python will handle rasterization)
  formData.append("xPt", String(finalXPt));
  formData.append("yPt", String(finalYPt));
  formData.append("wPt", String(finalWPt));
  formData.append("hPt", String(finalHPt));
  formData.append("pageWidthPt", String(pageWidthPt));
  formData.append("pageHeightPt", String(pageHeightPt));
  
  // Add requestId if provided (for correlated logging)
  if (config.requestId) {
    formData.append("requestId", config.requestId);
  }
  
  formData.append(
    "file",
    new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
    filename || "signed-work-order.pdf"
  );

  console.log(`[Signed OCR] Calling OCR endpoint:`, endpoint);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    
    // Try to parse JSON error response (Python FastAPI typically returns JSON)
    let errorMessage = text;
    let errorDetail: unknown = null;
    try {
      const errorJson = JSON.parse(text);
      // FastAPI error format: { "detail": "error message" } or { "detail": { "error": "..." } }
      if (errorJson.detail) {
        if (typeof errorJson.detail === "string") {
          errorMessage = errorJson.detail;
        } else if (errorJson.detail.error) {
          errorMessage = errorJson.detail.error;
          errorDetail = errorJson.detail;
        } else {
          errorMessage = JSON.stringify(errorJson.detail);
          errorDetail = errorJson.detail;
        }
      } else {
        errorMessage = JSON.stringify(errorJson);
        errorDetail = errorJson;
      }
    } catch {
      // Not JSON, use text as-is (truncated)
      errorMessage = text.substring(0, 500);
    }
    
    console.error("[Signed OCR] Error response from Python:", {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      errorMessage,
      errorDetail,
      rawBody: text.substring(0, 1000), // First 1000 chars for debugging
    });
    console.error("[Signed OCR] Request that failed:", {
      endpoint,
      templateId: config.templateId,
      page: config.page,
      xPt,
      yPt,
      wPt,
      hPt,
      pageWidthPt,
      pageHeightPt,
      dpi: config.dpi ?? 200,
    });
    
    throw new Error(
      `Signed OCR service failed (${response.status}): ${errorMessage}`
    );
  }

  const responseText = await response.text();
  console.log("[Signed OCR] Raw response text (first 500 chars):", responseText.substring(0, 500));
  
  let data: {
    workOrderNumber: string | null;
    confidence: number;
    rawText: string;
    templateId: string;
    page: number;
    usedVisionFallback: boolean;
    method: "local" | "vision";
    snippetImageUrl?: string | null;
  };

  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    console.error("[Signed OCR] Failed to parse JSON response:", parseError);
    console.error("[Signed OCR] Response text:", responseText);
    throw new Error(`Failed to parse OCR service response: ${parseError instanceof Error ? parseError.message : "Unknown error"}`);
  }

  // Log raw OCR response for debugging
  console.log("[Signed OCR] Parsed OCR service response:", {
    workOrderNumber: data.workOrderNumber,
    workOrderNumberType: typeof data.workOrderNumber,
    confidence: data.confidence,
    confidenceType: typeof data.confidence,
    rawText: data.rawText?.substring(0, 50),
    hasSnippetImageUrl: !!data.snippetImageUrl,
  });
  console.log("[Signed OCR] Calling OCR endpoint:", endpoint);

  // Ensure confidence is a number
  let confidenceValue: number;
  if (typeof data.confidence === "number") {
    confidenceValue = data.confidence;
  } else if (typeof data.confidence === "string") {
    confidenceValue = parseFloat(data.confidence);
    if (Number.isNaN(confidenceValue)) {
      console.warn("[Signed OCR] Confidence is not a valid number, defaulting to 0:", data.confidence);
      confidenceValue = 0;
    }
  } else {
    console.warn("[Signed OCR] Confidence is not a number or string, defaulting to 0:", data.confidence);
    confidenceValue = 0;
  }

  const label = mapConfidenceToLabel(confidenceValue);

  // Ensure workOrderNumber is preserved exactly as returned
  const woNumberValue = data.workOrderNumber != null ? String(data.workOrderNumber) : null;

  const result = {
    woNumber: woNumberValue,
    rawText: data.rawText ?? "",
    confidenceRaw: confidenceValue,
    confidenceLabel: label,
    snippetImageUrl: data.snippetImageUrl ?? null,
  };

  // Log parsed result for debugging
  console.log("[Signed OCR] Final OCR result:", {
    woNumber: result.woNumber,
    woNumberLength: result.woNumber?.length,
    confidenceRaw: result.confidenceRaw,
    confidenceLabel: result.confidenceLabel,
    rawTextLength: result.rawText?.length || 0,
  });

  return result;
}

