import type { TemplateRegion } from "./signedOcr";
import { getTemplateByFmKey } from "@/lib/templates/templatesSheets";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export type TemplateConfig = {
  templateId: string;
  page: number;
  region: TemplateRegion;
  dpi?: number;
};

/**
 * Fallback templates for development/testing when Templates sheet is not available.
 * These should only be used if the Templates sheet lookup fails.
 */
const FALLBACK_TEMPLATES: Record<string, TemplateConfig> = {
  superclean: {
    templateId: "superclean_fm1",
    page: 1,
    region: { xPct: 0.72, yPct: 0.00, wPct: 0.26, hPct: 0.05 },
    dpi: 300,
  },
   "23rd_group": {
     templateId: "23rd_group_fm1",
     page: 1,
     region: { xPct: 0.02, yPct: 0.14, wPct: 0.30, hPct: 0.03 },
     dpi: 250,
   },
};

/**
 * Get template configuration for an fmKey from the Templates sheet.
 * Falls back to hardcoded templates if sheet lookup fails (for development).
 */
export async function getTemplateConfigForFmKey(
  fmKey: string
): Promise<TemplateConfig> {
  const normalizedFmKey = fmKey.toLowerCase().trim();

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
      const sessionSpreadsheetId = session ? (session as any).googleSheetsSpreadsheetId : null;
      spreadsheetId = await getUserSpreadsheetId(user.userId, sessionSpreadsheetId);
    }

    if (!spreadsheetId) {
      throw new Error("Spreadsheet ID not configured");
    }

    // Get template from Templates sheet
    const template = await getTemplateByFmKey(
      user.googleAccessToken,
      spreadsheetId,
      user.userId,
      normalizedFmKey
    );

    if (!template) {
      throw new Error(`No template found for fmKey="${normalizedFmKey}"`);
    }

    // Validate template is not default (0/0/1/1)
    const TOLERANCE = 0.01;
    const isDefault = Math.abs(template.xPct) < TOLERANCE &&
                      Math.abs(template.yPct) < TOLERANCE &&
                      Math.abs(template.wPct - 1) < TOLERANCE &&
                      Math.abs(template.hPct - 1) < TOLERANCE;

    if (isDefault) {
      throw new Error(`Template for fmKey="${normalizedFmKey}" is not configured (still using default 0/0/1/1)`);
    }

    // Sanitize DPI: default 200, clamp 100-400
    let sanitizedDpi = 200;
    if (template.dpi !== undefined && template.dpi !== null) {
      const dpiNum = typeof template.dpi === "number" ? template.dpi : parseFloat(String(template.dpi));
      if (!isNaN(dpiNum) && dpiNum > 0) {
        sanitizedDpi = Math.max(100, Math.min(400, Math.round(dpiNum)));
      }
    }

    return {
      templateId: template.templateId || template.fmKey,
      page: template.page,
      region: {
        xPct: template.xPct,
        yPct: template.yPct,
        wPct: template.wPct,
        hPct: template.hPct,
      },
      dpi: sanitizedDpi,
    };
  } catch (error) {
    console.error(`[Template Config] Error getting template for fmKey="${normalizedFmKey}":`, error);
    
    // Fallback to hardcoded templates for development/testing
    const fallback = FALLBACK_TEMPLATES[normalizedFmKey];
    if (fallback) {
      console.warn(`[Template Config] Using fallback template for fmKey="${normalizedFmKey}"`);
      return fallback;
    }

    // Re-throw error if no fallback available
    throw new Error(
      `No template config found for fmKey="${normalizedFmKey}". ${error instanceof Error ? error.message : "Template not configured in Templates sheet."}`
    );
  }
}
