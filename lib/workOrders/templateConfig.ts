import type { TemplateRegion } from "./signedOcr";
import { getTemplateByFmKey } from "@/lib/templates/templatesSheets";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";

export type TemplateConfig = {
  templateId: string;
  page: number;
  region: TemplateRegion;
  dpi?: number;
  // PDF points fields (when coordSystem is PDF_POINTS_TOP_LEFT)
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
};

/**
 * Simple in-memory cache for template configs.
 * Cache key: `${spreadsheetId}:${fmKey}`
 * TTL: 5 minutes
 */
type CacheEntry = {
  config: TemplateConfig;
  expiresAt: number;
};

const templateCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(spreadsheetId: string, fmKey: string): string {
  return `${spreadsheetId}:${normalizeFmKey(fmKey)}`;
}

function getCachedConfig(spreadsheetId: string, fmKey: string): TemplateConfig | null {
  const key = getCacheKey(spreadsheetId, fmKey);
  const entry = templateCache.get(key);
  
  if (!entry) {
    return null;
  }
  
  // Check if expired
  if (Date.now() > entry.expiresAt) {
    templateCache.delete(key);
    return null;
  }
  
  return entry.config;
}

function setCachedConfig(spreadsheetId: string, fmKey: string, config: TemplateConfig): void {
  const key = getCacheKey(spreadsheetId, fmKey);
  templateCache.set(key, {
    config,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidate cache for a specific spreadsheetId + fmKey combination.
 * Called after template save to ensure fresh data.
 */
export function invalidateTemplateCache(spreadsheetId: string, fmKey: string): void {
  const key = getCacheKey(spreadsheetId, fmKey);
  templateCache.delete(key);
  console.log(`[Template Config] Cache invalidated for key: ${key}`);
}

/**
 * Get template configuration for an fmKey from the Templates sheet.
 * Throws when missing - NO fallback templates.
 * Throws Error("TEMPLATE_NOT_CONFIGURED") when no row found or template is default (0/0/1/1).
 */
export async function getTemplateConfigForFmKey(
  fmKey: string
): Promise<TemplateConfig> {
  // Use normalizeFmKey for consistent normalization (handles spaces, special chars, etc.)
  const normalizedFmKey = normalizeFmKey(fmKey);

  console.log(`[Template Config] Looking up template:`, {
    rawFmKey: fmKey,
    normalizedFmKey,
  });

  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user || !user.userId || !user.googleAccessToken) {
      throw new Error("User not authenticated or missing Google access token");
    }

    // Get spreadsheet ID
    const cookieStore = await cookies();
    const cookieSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
    
    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      const session = await auth();
      const sessionSpreadsheetId = session ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId : null;
      spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
    }

    if (!spreadsheetId) {
      throw new Error("Spreadsheet ID not configured");
    }

    // Check cache first
    const cached = getCachedConfig(spreadsheetId, normalizedFmKey);
    if (cached) {
      console.log(`[Template Config] Cache hit for ${spreadsheetId}:${normalizedFmKey}`);
      return cached;
    }

    // Get template from Templates sheet (getTemplateByFmKey normalizes fmKey internally)
    const template = await getTemplateByFmKey(
      user.googleAccessToken,
      spreadsheetId,
      user.userId,
      normalizedFmKey
    );

    if (!template) {
      // Log debug info to help diagnose why template wasn't found
      try {
        const { listTemplatesForUser } = await import("@/lib/templates/templatesSheets");
        const allTemplates = await listTemplatesForUser(
          user.googleAccessToken,
          spreadsheetId,
          user.userId
        );
        console.log(`[Template Config] Template row NOT FOUND for normalizedFmKey="${normalizedFmKey}"`, {
          searchedFmKey: normalizedFmKey,
          rawFmKey: fmKey,
          userId: user.userId,
          spreadsheetId: spreadsheetId.substring(0, 10) + "...",
          foundTemplates: allTemplates.length,
          availableFmKeys: allTemplates.map(t => ({ 
            raw: t.fmKey, 
            normalized: normalizeFmKey(t.fmKey),
            hasPoints: !!(t.xPt && t.yPt && t.wPt && t.hPt && t.pageWidthPt && t.pageHeightPt),
            coordSystem: t.coordSystem,
          })),
        });
      } catch (listError) {
        console.error(`[Template Config] Error listing templates for debug:`, listError);
      }
      
      // No row found for fmKey - throw TEMPLATE_NOT_CONFIGURED
      throw new Error("TEMPLATE_NOT_CONFIGURED");
    }

    console.log(`[Template Config] Template row FOUND for normalizedFmKey="${normalizedFmKey}"`, {
      templateId: template.templateId,
      page: template.page,
      coordSystem: template.coordSystem,
      hasPoints: !!(template.xPt && template.yPt && template.wPt && template.hPt && template.pageWidthPt && template.pageHeightPt),
      points: template.xPt !== undefined ? {
        xPt: template.xPt,
        yPt: template.yPt,
        wPt: template.wPt,
        hPt: template.hPt,
        pageWidthPt: template.pageWidthPt,
        pageHeightPt: template.pageHeightPt,
      } : null,
    });

    // Normalize coordSystem: "PDF_POINTS" from sheet -> "PDF_POINTS_TOP_LEFT" internally
    const normalizedCoordSystem = template.coordSystem === "PDF_POINTS" 
      ? "PDF_POINTS_TOP_LEFT" 
      : template.coordSystem;

    // POINTS-ONLY: All templates MUST have PDF points. No percentage fallback.
    // Validate that all required PDF point fields exist and are valid
    const hasAllPtFields = 
      template.xPt !== undefined && template.xPt !== null && template.xPt > 0 &&
      template.yPt !== undefined && template.yPt !== null && template.yPt > 0 &&
      template.wPt !== undefined && template.wPt !== null && template.wPt > 0 &&
      template.hPt !== undefined && template.hPt !== null && template.hPt > 0 &&
      template.pageWidthPt !== undefined && template.pageWidthPt !== null && template.pageWidthPt > 0 &&
      template.pageHeightPt !== undefined && template.pageHeightPt !== null && template.pageHeightPt > 0;

    if (!hasAllPtFields) {
      console.error(`[Template Config] Template row EXISTS but missing or invalid PDF points fields:`, {
        normalizedFmKey,
        templateId: template.templateId,
        coordSystem: template.coordSystem,
        xPt: template.xPt,
        yPt: template.yPt,
        wPt: template.wPt,
        hPt: template.hPt,
        pageWidthPt: template.pageWidthPt,
        pageHeightPt: template.pageHeightPt,
        note: "ALL templates must have PDF points - no percentage fallback allowed",
      });
      throw new Error("TEMPLATE_NOT_CONFIGURED");
    }

    // Convert PDF points to percentages for TemplateRegion
    // (OCR service currently expects percentages, but we're using points as source of truth)
    const xPct = template.xPt / template.pageWidthPt!;
    const yPct = template.yPt / template.pageHeightPt!;
    const wPct = template.wPt / template.pageWidthPt!;
    const hPct = template.hPt / template.pageHeightPt!;

    const region: TemplateRegion = {
      xPct,
      yPct,
      wPct,
      hPct,
    };

    // Sanitize DPI: default 200, clamp 100-400
    let sanitizedDpi = 200;
    if (template.dpi !== undefined && template.dpi !== null) {
      const dpiNum = typeof template.dpi === "number" ? template.dpi : parseFloat(String(template.dpi));
      if (!isNaN(dpiNum) && dpiNum > 0) {
        sanitizedDpi = Math.max(100, Math.min(400, Math.round(dpiNum)));
      }
    }

    const config: TemplateConfig = {
      templateId: template.templateId || template.fmKey,
      page: template.page,
      region,
      dpi: sanitizedDpi,
      // PDF points are always included (points-only mode)
      xPt: template.xPt,
      yPt: template.yPt,
      wPt: template.wPt,
      hPt: template.hPt,
      pageWidthPt: template.pageWidthPt,
      pageHeightPt: template.pageHeightPt,
    };

    console.log(`[Template Config] Using PDF points for ${normalizedFmKey}:`, {
      xPt: template.xPt,
      yPt: template.yPt,
      wPt: template.wPt,
      hPt: template.hPt,
      pageWidthPt: template.pageWidthPt,
      pageHeightPt: template.pageHeightPt,
      convertedToPercentages: region,
    });

    // Cache the result
    setCachedConfig(spreadsheetId, normalizedFmKey, config);
    
    return config;
  } catch (error) {
    console.error(`[Template Config] Error getting template for fmKey="${normalizedFmKey}":`, error);
    
    // Re-throw error - no fallbacks
    throw error;
  }
}
