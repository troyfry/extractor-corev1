import type { TemplateRegion } from "./signedOcr";
import { getCurrentUser } from "@/lib/auth/currentUser";
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

function getCacheKey(workspaceId: string, fmKey: string): string {
  return `${workspaceId}:${normalizeFmKey(fmKey)}`;
}

function getCachedConfig(workspaceId: string, fmKey: string): TemplateConfig | null {
  const key = getCacheKey(workspaceId, fmKey);
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

function setCachedConfig(workspaceId: string, fmKey: string, config: TemplateConfig): void {
  const key = getCacheKey(workspaceId, fmKey);
  templateCache.set(key, {
    config,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidate cache for a specific workspaceId + fmKey combination.
 * Called after template save to ensure fresh data.
 */
export function invalidateTemplateCache(workspaceId: string, fmKey: string): void {
  const key = getCacheKey(workspaceId, fmKey);
  templateCache.delete(key);
  console.log(`[Template Config] Cache invalidated for key: ${key}`);
}

/**
 * Get template configuration for an fmKey from the database (DB-native).
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
    if (!user || !user.userId) {
      throw new Error("User not authenticated");
    }

    // Get workspace ID (DB-native)
    const { getWorkspaceIdForUser } = await import("@/lib/db/utils/getWorkspaceId");
    const workspaceId = await getWorkspaceIdForUser();
    
    if (!workspaceId) {
      throw new Error("Workspace not found. Please complete onboarding.");
    }

    // Check cache first (using workspaceId instead of spreadsheetId)
    const cacheKey = `${workspaceId}:${normalizedFmKey}`;
    const cached = templateCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      console.log(`[Template Config] Cache hit for ${workspaceId}:${normalizedFmKey}`);
      return cached.config;
    }

    // Get template from DB (fm_profiles.wo_number_region)
    const { listFmProfiles } = await import("@/lib/db/services/fmProfiles");
    const profiles = await listFmProfiles(workspaceId);
    const profile = profiles.find(p => p.fm_key === normalizedFmKey);
    
    if (!profile) {
      throw new Error(`FM profile "${normalizedFmKey}" not found`);
    }

    const woNumberRegion = profile.wo_number_region as {
      page?: number;
      xPct?: number;
      yPct?: number;
      wPct?: number;
      hPct?: number;
      xPt?: number;
      yPt?: number;
      wPt?: number;
      hPt?: number;
      pageWidthPt?: number;
      pageHeightPt?: number;
    } | null;

    if (!woNumberRegion) {
      throw new Error(`Template coordinates not configured for FM profile "${normalizedFmKey}"`);
    }

    // Check if it's a default template (0/0/1/1)
    if (
      (woNumberRegion.xPct === 0 && woNumberRegion.yPct === 0 && 
       woNumberRegion.wPct === 1 && woNumberRegion.hPct === 1) ||
      (!woNumberRegion.xPt && !woNumberRegion.yPt && !woNumberRegion.wPt && !woNumberRegion.hPt)
    ) {
      throw new Error("TEMPLATE_NOT_CONFIGURED");
    }

    // Build TemplateConfig from DB data
    const templateConfig: TemplateConfig = {
      templateId: normalizedFmKey,
      page: woNumberRegion.page || 1,
      region: {
        xPct: woNumberRegion.xPct || 0,
        yPct: woNumberRegion.yPct || 0,
        wPct: woNumberRegion.wPct || 1,
        hPct: woNumberRegion.hPct || 1,
      },
      // PDF points (preferred)
      xPt: woNumberRegion.xPt,
      yPt: woNumberRegion.yPt,
      wPt: woNumberRegion.wPt,
      hPt: woNumberRegion.hPt,
      pageWidthPt: woNumberRegion.pageWidthPt,
      pageHeightPt: woNumberRegion.pageHeightPt,
    };

    // Cache the result
    templateCache.set(cacheKey, {
      config: templateConfig,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    console.log(`[Template Config] Loaded template from DB:`, {
      fmKey: normalizedFmKey,
      hasPoints: !!(templateConfig.xPt && templateConfig.yPt && templateConfig.wPt && templateConfig.hPt),
      hasPercentages: !!(templateConfig.region.xPct !== undefined),
    });

    return templateConfig;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // TEMPLATE_NOT_CONFIGURED is expected and handled gracefully by the processor
    // Log it as a warning instead of an error to reduce noise
    if (errorMessage === "TEMPLATE_NOT_CONFIGURED" || errorMessage.includes("TEMPLATE_NOT_CONFIGURED")) {
      console.warn(`[Template Config] Template not configured for fmKey="${normalizedFmKey}". Will be handled gracefully.`);
    } else {
      console.error(`[Template Config] Error getting template for fmKey="${normalizedFmKey}":`, error);
    }
    
    // Re-throw error - no fallbacks
    throw error;
  }
}

