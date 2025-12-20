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
  region: TemplateRegion;
  dpi?: number;
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
  formData.append("xPct", String(config.region.xPct));
  formData.append("yPct", String(config.region.yPct));
  formData.append("wPct", String(config.region.wPct));
  formData.append("hPct", String(config.region.hPct));
  formData.append("dpi", String(config.dpi ?? 200));
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

