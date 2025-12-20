import type { TemplateRegion } from "./signedOcr";

export type TemplateConfig = {
  templateId: string;
  page: number;
  region: TemplateRegion;
  dpi?: number;
};

/**
 * Temporary in-memory templates for development.
 * Later, this should be replaced by a lookup against the FM_Templates sheet.
 */
const HARDCODED_TEMPLATES: Record<string, TemplateConfig> = {
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

export async function getTemplateConfigForFmKey(
  fmKey: string
): Promise<TemplateConfig> {
  const key = fmKey.toLowerCase().trim();
  const cfg = HARDCODED_TEMPLATES[key];
  if (!cfg) {
    throw new Error(
      `No template config defined for fmKey="${fmKey}". Add to HARDCODED_TEMPLATES or implement FM_Templates sheet lookup.`
    );
  }
  return cfg;
}

