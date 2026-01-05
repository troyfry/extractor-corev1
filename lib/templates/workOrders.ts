/**
 * Work Order Template Registry
 * 
 * Config-only registry for work order templates to support future template matching
 * and preset OCR zones. Templates define where to look for work order numbers
 * on PDFs from different issuers/platforms.
 */

/**
 * Zone definition for work order number extraction (PDF points).
 * 
 * ⚠️ POINTS-ONLY: All values are PDF points. No percentages.
 */
export type WorkOrderNumberZone = {
  /** Page number (1-indexed) */
  page: number;
  /** X position in PDF points */
  xPt: number;
  /** Y position in PDF points */
  yPt: number;
  /** Width in PDF points */
  wPt: number;
  /** Height in PDF points */
  hPt: number;
  /** Page width in PDF points */
  pageWidthPt: number;
  /** Page height in PDF points */
  pageHeightPt: number;
  /** Optional PDF bounds offset */
  boundsPt?: { x0: number; y0: number; x1: number; y1: number };
};

/**
 * Work Order Template definition.
 * Each template represents a known work order format from a specific issuer/platform.
 */
export type WorkOrderTemplate = {
  /** Normalized issuer key (platform identifier) */
  issuerKey: string;
  /** Unique template identifier */
  templateId: string;
  /** Human-readable label */
  label: string;
  /** Zone definition for work order number extraction */
  woNumberZone: WorkOrderNumberZone;
  /** Optional notes about the template */
  notes?: string;
};

/**
 * Issuer alias mapping.
 * Maps normalized sender domains to platform issuer keys.
 * This allows templates to be matched by platform (e.g., "servicechannel") even when
 * the sender domain is different (e.g., "workorders@23rdgroup.com").
 * 
 * Example: "23rdgroup_com" → "servicechannel" (if 23rd Group uses ServiceChannel)
 */
export const ISSUER_ALIASES: Record<string, string> = {
  // Add domain-to-platform mappings here as needed
  // Example: "23rdgroup_com": "servicechannel",
};

/**
 * Starter templates with placeholder zones.
 * These are safe "first guesses" that can be refined later with actual OCR rectangle selection.
 */
// Note: WORK_ORDER_TEMPLATES removed - templates must be configured per-user with actual PDF geometry
// Starter templates are no longer valid without page dimensions
export const WORK_ORDER_TEMPLATES: WorkOrderTemplate[] = [];

/**
 * Normalize an issuer key for template matching.
 * 
 * Handles both platform names (e.g., "ServiceChannel") and sender domains
 * (e.g., "workorders@23rdgroup.com"). Normalizes to a consistent format
 * for template lookup.
 * 
 * Steps:
 * 1. Lowercase
 * 2. Trim whitespace
 * 3. Extract domain from email if present (part after @)
 * 4. Convert dots to underscores
 * 5. Remove unsafe characters (keep alphanumeric and underscores)
 * 
 * @param input - Raw issuer identifier (platform name or email domain)
 * @returns Normalized issuer key
 */
export function normalizeIssuerKey(input: string): string {
  if (!input || typeof input !== "string") {
    return "unknown";
  }

  let normalized = input.trim().toLowerCase();

  // Extract domain from email if present (e.g., "workorders@23rdgroup.com" -> "23rdgroup.com")
  const atIndex = normalized.indexOf("@");
  if (atIndex !== -1) {
    normalized = normalized.substring(atIndex + 1);
  }

  // Convert dots to underscores (e.g., "23rdgroup.com" -> "23rdgroup_com")
  normalized = normalized.replace(/\./g, "_");

  // Remove unsafe characters (keep only alphanumeric and underscores)
  normalized = normalized.replace(/[^a-z0-9_]/g, "");

  // Ensure non-empty result
  return normalized || "unknown";
}

/**
 * Get template for a given issuer key.
 * 
 * Resolves aliases before matching templates. If the normalized issuer key
 * has an alias mapping, uses the alias target for template lookup.
 * 
 * @param issuerKey - Normalized issuer key (use normalizeIssuerKey() first)
 * @returns Matching template, or undefined if not found
 */
export function getTemplateForIssuer(issuerKey: string): WorkOrderTemplate | undefined {
  const normalized = normalizeIssuerKey(issuerKey);
  
  // Resolve alias if present (e.g., "23rdgroup_com" → "servicechannel")
  const resolvedKey = ISSUER_ALIASES[normalized] || normalized;
  
  return WORK_ORDER_TEMPLATES.find((template) => template.issuerKey === resolvedKey);
}

/**
 * Get all available templates.
 * 
 * @returns Array of all work order templates
 */
export function getAllTemplates(): WorkOrderTemplate[] {
  return [...WORK_ORDER_TEMPLATES];
}

/**
 * Debug/sanity function to test template matching.
 * Logs the chosen template for sample inputs.
 * 
 * This is a simple unit-style test (no test framework needed).
 * Run this manually or call from a debug endpoint to verify template matching.
 */
export function debugTemplateMatching(): void {
  const testInputs = [
    "workorders@23rdgroup.com",
    "ServiceChannel",
    "nambar.com",
    "service_trade",
    "unknown-platform",
  ];

  console.log("=== Work Order Template Matching Debug ===\n");

  for (const input of testInputs) {
    const normalized = normalizeIssuerKey(input);
    const template = getTemplateForIssuer(normalized); // Use normalized value directly

    console.log(`Input: "${input}"`);
    console.log(`  Normalized: "${normalized}"`);
    if (template) {
      console.log(`  ✓ Found template: ${template.label} (${template.templateId})`);
      console.log(`    Zone: page ${template.woNumberZone.page}, (${template.woNumberZone.xPt}, ${template.woNumberZone.yPt}) ${template.woNumberZone.wPt}×${template.woNumberZone.hPt} pt`);
    } else {
      console.log(`  ✗ No template found`);
    }
    console.log("");
  }

  console.log("=== End Debug ===\n");
}

