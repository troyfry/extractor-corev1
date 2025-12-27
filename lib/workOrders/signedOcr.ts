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
  region: TemplateRegion | null; // null when using PDF points mode
  dpi?: number;
  // PDF points fields (when using PDF_POINTS_TOP_LEFT coordinate system)
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
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

  const formData = new FormData();
  formData.append("templateId", config.templateId);
  formData.append("page", String(config.page));
  formData.append("dpi", String(config.dpi ?? 200));
  
  // If PDF points are available, use them (convert to pixels based on DPI)
  // Otherwise fall back to percentages (region must not be null)
  if (config.xPt !== undefined && config.yPt !== undefined && 
      config.wPt !== undefined && config.hPt !== undefined &&
      config.pageWidthPt !== undefined && config.pageHeightPt !== undefined) {
    // Calculate scale: dpi / 72 (PDF points are in 1/72 inch units)
    const dpi = config.dpi ?? 200;
    const scale = dpi / 72;
    
    // Rasterize page at dpi: image dimensions = page dimensions * scale
    const imageWidthPx = config.pageWidthPt * scale;
    const imageHeightPx = config.pageHeightPt * scale;
    
    // Convert points → pixels using the actual output image size
    const xPx = (config.xPt / config.pageWidthPt) * imageWidthPx;
    const yPx = (config.yPt / config.pageHeightPt) * imageHeightPx;
    const wPx = (config.wPt / config.pageWidthPt) * imageWidthPx;
    const hPx = (config.hPt / config.pageHeightPt) * imageHeightPx;
    
    // Send pixels to OCR service
    formData.append("xPx", String(Math.round(xPx)));
    formData.append("yPx", String(Math.round(yPx)));
    formData.append("wPx", String(Math.round(wPx)));
    formData.append("hPx", String(Math.round(hPx)));
    formData.append("imageWidthPx", String(Math.round(imageWidthPx)));
    formData.append("imageHeightPx", String(Math.round(imageHeightPx)));
    formData.append("coordSystem", "PDF_POINTS_TOP_LEFT");
    
    console.log(`[Signed OCR] Using PDF points (converted to pixels):`, {
      xPt: config.xPt,
      yPt: config.yPt,
      wPt: config.wPt,
      hPt: config.hPt,
      pageWidthPt: config.pageWidthPt,
      pageHeightPt: config.pageHeightPt,
      dpi,
      scale,
      imageWidthPx: Math.round(imageWidthPx),
      imageHeightPx: Math.round(imageHeightPx),
      xPx: Math.round(xPx),
      yPx: Math.round(yPx),
      wPx: Math.round(wPx),
      hPx: Math.round(hPx),
    });
  } else {
    // Legacy: use percentages (region must not be null)
    if (!config.region) {
      throw new Error("Region is required when PDF points are not provided");
    }
    formData.append("xPct", String(config.region.xPct));
    formData.append("yPct", String(config.region.yPct));
    formData.append("wPct", String(config.region.wPct));
    formData.append("hPct", String(config.region.hPct));
    formData.append("coordSystem", "PERCENTAGES");
  }
  
  formData.append(
    "file",
    new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
    filename || "signed-work-order.pdf"
  );

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[Signed OCR] Error response:", text);
    throw new Error(
      `Signed OCR service failed with status ${response.status}: ${text}`
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

