/**
 * Regression test: Ensure templates are points-only.
 * 
 * This test prevents percentage fields from being used in template storage or processing.
 * ALL templates MUST store PDF points (xPt, yPt, wPt, hPt + page geometry).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { glob } from "glob";

describe("Templates: Points-only enforcement", () => {
  it("should not find xPct/yPct/wPct/hPct in template save routes", async () => {
    const templateSaveRoutes = [
      "app/api/templates/save/route.ts",
      "app/api/onboarding/templates/save/route.ts",
    ];

    for (const routePath of templateSaveRoutes) {
      const fullPath = join(process.cwd(), routePath);
      try {
        const content = readFileSync(fullPath, "utf-8");
        
        // Check for percentage field writes (should be empty strings or 0)
        const hasPctWrite = /(xPct|yPct|wPct|hPct)\s*[:=]\s*(?![""]|0|String\(template\.(xPct|yPct|wPct|hPct)\))/.test(content);
        
        if (hasPctWrite) {
          // Allow empty string assignments (deprecated fields)
          const hasEmptyStringPct = /(xPct|yPct|wPct|hPct)\s*[:=]\s*[""]/.test(content);
          if (!hasEmptyStringPct) {
            throw new Error(
              `Found percentage field write in ${routePath}. Templates must store only PDF points.`
            );
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          // File doesn't exist, skip
          continue;
        }
        throw error;
      }
    }
  });

  it("should require PDF points in template types", () => {
    const templateTypesFile = join(process.cwd(), "lib/templates/templatesSheets.ts");
    const content = readFileSync(templateTypesFile, "utf-8");

    // Check that Template type requires PDF points
    const hasRequiredPoints = 
      /xPt:\s*number/.test(content) &&
      /yPt:\s*number/.test(content) &&
      /wPt:\s*number/.test(content) &&
      /hPt:\s*number/.test(content) &&
      /pageWidthPt:\s*number/.test(content) &&
      /pageHeightPt:\s*number/.test(content);

    expect(hasRequiredPoints).toBe(true);
  });

  it("should not allow percentage fallback in templateConfig", () => {
    const templateConfigFile = join(process.cwd(), "lib/workOrders/templateConfig.ts");
    const content = readFileSync(templateConfigFile, "utf-8");

    // Check for legacy fallback logic (should be removed)
    const hasLegacyFallback = 
      /legacy.*fallback/i.test(content) ||
      /use percentages.*if points are missing/i.test(content);

    expect(hasLegacyFallback).toBe(false);
  });

  it("should validate PDF points in template save endpoints", () => {
    const saveRoutes = [
      "app/api/templates/save/route.ts",
      "app/api/onboarding/templates/save/route.ts",
    ];

    for (const routePath of saveRoutes) {
      const fullPath = join(process.cwd(), routePath);
      try {
        const content = readFileSync(fullPath, "utf-8");
        
        // Check for domain layer validation (validateTemplateRegion) or legacy validatePdfPoints
        // Domain layer is preferred, but legacy is acceptable during migration
        const hasDomainValidation = /validateTemplateRegion/.test(content);
        const hasLegacyValidation = /validatePdfPoints/.test(content);
        const hasValidation = hasDomainValidation || hasLegacyValidation;
        
        expect(hasValidation).toBe(true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
    }
  });
});

