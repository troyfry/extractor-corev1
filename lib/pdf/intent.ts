/**
 * PDF Intent Policy Module
 * 
 * Centralized logic for determining PDF processing behavior based on intent.
 * This ensures consistent normalization, raster handling, and logging across all PDF operations.
 * 
 * Intents:
 * - TEMPLATE_CAPTURE: For template capture workflows (no normalization, block raster-only PDFs)
 * - SIGNED_PROCESSING: For signed PDF processing (normalize by default, allow raster)
 * - GENERAL_VIEW: For general preview/viewing (backwards compatible behavior)
 */

export type PdfIntent = "TEMPLATE_CAPTURE" | "SIGNED_PROCESSING" | "GENERAL_VIEW";

export const PDF_INTENTS: readonly PdfIntent[] = [
  "TEMPLATE_CAPTURE",
  "SIGNED_PROCESSING",
  "GENERAL_VIEW",
] as const;

/**
 * Parse intent from unknown value.
 * Returns null if missing or invalid (does not throw).
 */
export function parsePdfIntent(value: unknown): PdfIntent | null {
  if (typeof value !== "string") {
    return null;
  }
  if (PDF_INTENTS.includes(value as PdfIntent)) {
    return value as PdfIntent;
  }
  return null;
}

/**
 * Resolved PDF intent policy with all behavior flags.
 */
export type PdfIntentPolicy = {
  intent: PdfIntent | null; // null = legacy mode
  normalize: boolean; // whether normalization should occur
  skipNormalization: boolean; // preserve legacy semantic too
  allowRaster: boolean;
  shouldBlockRaster: boolean; // true only for TEMPLATE_CAPTURE unless override
  reason: string; // short string used in logs
};

/**
 * Resolve PDF intent policy from request arguments.
 * 
 * @param args.intent - Intent value (parsed via parsePdfIntent)
 * @param args.allowRaster - Whether to allow raster-only PDFs (string "true"/"false" or boolean)
 * @param args.skipNormalization - Legacy flag (string "true"/"false" or boolean)
 * @param args.legacyDefaultSkipNormalization - Default skipNormalization for legacy mode
 */
export function resolvePdfIntentPolicy(args: {
  intent: unknown;
  allowRaster?: unknown;
  skipNormalization?: unknown;
  legacyDefaultSkipNormalization?: boolean;
}): PdfIntentPolicy {
  const parsedIntent = parsePdfIntent(args.intent);
  const allowRasterRaw = args.allowRaster;
  const skipNormalizationRaw = args.skipNormalization;
  
  // Parse boolean flags (support both string "true"/"false" and boolean)
  const allowRasterBool = 
    allowRasterRaw === "true" || allowRasterRaw === true;
  const skipNormalizationBool = 
    skipNormalizationRaw === "true" || skipNormalizationRaw === true;
  
  const legacyDefaultSkipNormalization = args.legacyDefaultSkipNormalization ?? false;

  if (parsedIntent === "TEMPLATE_CAPTURE") {
    // TEMPLATE_CAPTURE: Never normalize, block raster-only PDFs (unless allowRaster=true)
    return {
      intent: "TEMPLATE_CAPTURE",
      normalize: false,
      skipNormalization: true,
      allowRaster: allowRasterBool,
      shouldBlockRaster: !allowRasterBool,
      reason: "template_capture",
    };
  } else if (parsedIntent === "SIGNED_PROCESSING") {
    // SIGNED_PROCESSING: Normalize by default (unless skipNormalization=true), allow raster
    return {
      intent: "SIGNED_PROCESSING",
      normalize: !skipNormalizationBool,
      skipNormalization: skipNormalizationBool,
      allowRaster: true, // Always allow raster for signed processing
      shouldBlockRaster: false,
      reason: "signed_processing",
    };
  } else if (parsedIntent === "GENERAL_VIEW") {
    // GENERAL_VIEW: Behave like legacy with explicit intent
    const effectiveSkipNormalization = skipNormalizationRaw !== undefined
      ? skipNormalizationBool
      : legacyDefaultSkipNormalization;
    
    return {
      intent: "GENERAL_VIEW",
      normalize: !effectiveSkipNormalization,
      skipNormalization: effectiveSkipNormalization,
      allowRaster: allowRasterBool,
      shouldBlockRaster: false,
      reason: "general_view",
    };
  } else {
    // Intent missing/invalid (legacy mode): Same as GENERAL_VIEW, but reason="legacy"
    const effectiveSkipNormalization = skipNormalizationRaw !== undefined
      ? skipNormalizationBool
      : legacyDefaultSkipNormalization;
    
    return {
      intent: null,
      normalize: !effectiveSkipNormalization,
      skipNormalization: effectiveSkipNormalization,
      allowRaster: allowRasterBool,
      shouldBlockRaster: false,
      reason: "legacy",
    };
  }
}

