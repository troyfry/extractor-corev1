/**
 * Template Region Domain Layer
 * 
 * Defines the schema, validation, and normalization for template regions.
 * This is the single source of truth for region data structures.
 */

import { validatePdfPoints, assertPdfCropPointsValid, type PdfCropPoints, type BoundsPt } from "@/lib/_deprecated/domain/coordinates/pdfPoints";

/**
 * Coordinate system types for template regions.
 */
export type CoordSystem = "PDF_POINTS" | "PDF_POINTS_TOP_LEFT";

/**
 * Template region in PDF points (top-left origin).
 * This is the canonical format for all template regions.
 */
export interface TemplateRegion {
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  pageWidthPt: number;
  pageHeightPt: number;
  boundsPt?: BoundsPt; // Optional, used for normalization
}

/**
 * Raw template region data (may come from API/UI).
 * Used for parsing and validation before normalization.
 */
export interface RawTemplateRegion {
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  boundsPt?: BoundsPt;
  coordSystem?: string;
  // Legacy percentage fields (rejected during validation)
  xPct?: number;
  yPct?: number;
  wPct?: number;
  hPct?: number;
}

/**
 * Validate that a raw region contains all required PDF points fields.
 * Throws if validation fails.
 */
export function validateRegion(region: RawTemplateRegion): void {
  // Reject percentage fields
  if (region.xPct !== undefined || region.yPct !== undefined || 
      region.wPct !== undefined || region.hPct !== undefined) {
    throw new Error(
      "Percentage fields (xPct, yPct, wPct, hPct) are not allowed. " +
      "Use PDF points (xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt) instead."
    );
  }

  // Require all PDF points fields
  if (region.xPt === undefined || region.yPt === undefined || 
      region.wPt === undefined || region.hPt === undefined ||
      region.pageWidthPt === undefined || region.pageHeightPt === undefined) {
    throw new Error(
      "PDF_POINTS format required: xPt, yPt, wPt, hPt, pageWidthPt, and pageHeightPt are required"
    );
  }

  // Validate types
  if (typeof region.xPt !== "number" || typeof region.yPt !== "number" ||
      typeof region.wPt !== "number" || typeof region.hPt !== "number" ||
      typeof region.pageWidthPt !== "number" || typeof region.pageHeightPt !== "number") {
    throw new Error("All PDF point fields must be numbers");
  }

  // Validate values are finite
  if (!Number.isFinite(region.xPt) || !Number.isFinite(region.yPt) ||
      !Number.isFinite(region.wPt) || !Number.isFinite(region.hPt) ||
      !Number.isFinite(region.pageWidthPt) || !Number.isFinite(region.pageHeightPt)) {
    throw new Error("All PDF point fields must be finite numbers");
  }

  // Validate page dimensions are positive
  if (region.pageWidthPt <= 0 || region.pageHeightPt <= 0) {
    throw new Error("pageWidthPt and pageHeightPt must be positive");
  }

  // Validate region dimensions are positive
  if (region.wPt <= 0 || region.hPt <= 0) {
    throw new Error("wPt and hPt must be positive");
  }

  // Validate region is within page bounds
  if (region.xPt < 0 || region.yPt < 0 ||
      region.xPt + region.wPt > region.pageWidthPt ||
      region.yPt + region.hPt > region.pageHeightPt) {
    throw new Error(
      `Region out of bounds. Page size: ${region.pageWidthPt} x ${region.pageHeightPt} points. ` +
      `Region: x=${region.xPt}, y=${region.yPt}, w=${region.wPt}, h=${region.hPt}`
    );
  }

  // Use centralized validation from domain layer
  try {
    validatePdfPoints(
      { xPt: region.xPt, yPt: region.yPt, wPt: region.wPt, hPt: region.hPt },
      { width: region.pageWidthPt, height: region.pageHeightPt },
      "template"
    );
  } catch (validationError) {
    throw new Error(
      validationError instanceof Error ? validationError.message : "Invalid PDF points"
    );
  }

  // If boundsPt is provided, validate complete crop points
  if (region.boundsPt) {
    try {
      const crop: PdfCropPoints = {
        xPt: region.xPt,
        yPt: region.yPt,
        wPt: region.wPt,
        hPt: region.hPt,
        pageWidthPt: region.pageWidthPt,
        pageHeightPt: region.pageHeightPt,
        boundsPt: region.boundsPt,
      };
      assertPdfCropPointsValid(crop, "Template region");
    } catch (cropError) {
      throw new Error(
        cropError instanceof Error ? cropError.message : "Invalid crop points with bounds"
      );
    }
  }
}

/**
 * Normalize coordinate system string to canonical type.
 * Handles legacy "PDF_POINTS" -> "PDF_POINTS_TOP_LEFT" conversion.
 */
export function normalizeCoordSystem(coordSystem?: string): CoordSystem {
  if (!coordSystem) {
    return "PDF_POINTS_TOP_LEFT"; // Default
  }
  
  // Normalize legacy "PDF_POINTS" to "PDF_POINTS_TOP_LEFT"
  if (coordSystem === "PDF_POINTS" || coordSystem === "PDF_POINTS_TOP_LEFT") {
    return "PDF_POINTS_TOP_LEFT";
  }
  
  // Return as-is if already canonical
  return coordSystem as CoordSystem;
}

/**
 * Convert raw region to normalized TemplateRegion.
 * Validates and normalizes the region data.
 */
export function normalizeRegion(region: RawTemplateRegion): TemplateRegion {
  // Validate first
  validateRegion(region);

  // Normalize coordinate system (for consistency, though we always use PDF_POINTS_TOP_LEFT)
  // Normalize coordinate system to canonical format
  normalizeCoordSystem(region.coordSystem);

  // Round to 2 decimal places for consistency
  const normalized: TemplateRegion = {
    xPt: Math.round(region.xPt! * 100) / 100,
    yPt: Math.round(region.yPt! * 100) / 100,
    wPt: Math.round(region.wPt! * 100) / 100,
    hPt: Math.round(region.hPt! * 100) / 100,
    pageWidthPt: Math.round(region.pageWidthPt! * 100) / 100,
    pageHeightPt: Math.round(region.pageHeightPt! * 100) / 100,
    boundsPt: region.boundsPt,
  };

  return normalized;
}

/**
 * Type guard: Check if an object is a valid TemplateRegion.
 */
export function isTemplateRegion(obj: unknown): obj is TemplateRegion {
  if (!obj || typeof obj !== "object") {
    return false;
  }

  const r = obj as Record<string, unknown>;
  
  return (
    typeof r.xPt === "number" && Number.isFinite(r.xPt) &&
    typeof r.yPt === "number" && Number.isFinite(r.yPt) &&
    typeof r.wPt === "number" && Number.isFinite(r.wPt) && r.wPt > 0 &&
    typeof r.hPt === "number" && Number.isFinite(r.hPt) && r.hPt > 0 &&
    typeof r.pageWidthPt === "number" && Number.isFinite(r.pageWidthPt) && r.pageWidthPt > 0 &&
    typeof r.pageHeightPt === "number" && Number.isFinite(r.pageHeightPt) && r.pageHeightPt > 0 &&
    r.xPt >= 0 && r.yPt >= 0 &&
    r.xPt + r.wPt <= r.pageWidthPt &&
    r.yPt + r.hPt <= r.pageHeightPt
  );
}

