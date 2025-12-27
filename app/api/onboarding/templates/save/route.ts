/**
 * API route for saving template crop zones during onboarding.
 * 
 * POST /api/onboarding/templates/save
 * Body: { fmKey: string, page: number, xPct: number, yPct: number, wPct: number, hPct: number, templateId?: string }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { resetApiCallCount, getApiCallCount, ensureUsersSheet } from "@/lib/onboarding/usersSheet";
import { upsertTemplate } from "@/lib/templates/templatesSheets";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  resetApiCallCount();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google OAuth token not available. Please sign in again." },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Support both new format (rectPx + PDF points) and legacy format (xPct/yPct/wPct/hPct)
    const isNewFormat = body.rectPx && body.renderWidthPx && body.pageWidthPt;
    
    let fmKey: string;
    let page: number;
    let rectPx: { x: number; y: number; w: number; h: number } | undefined;
    let renderWidthPx: number | undefined;
    let renderHeightPx: number | undefined;
    let pageWidthPt: number | undefined;
    let pageHeightPt: number | undefined;
    let xPct: number | undefined;
    let yPct: number | undefined;
    let wPct: number | undefined;
    let hPct: number | undefined;
    let templateId: string | undefined;
    let dpi: number | undefined;

    if (isNewFormat) {
      // New format: rectPx + PDF points
      fmKey = body.fmKey;
      page = body.page;
      rectPx = body.rectPx;
      renderWidthPx = body.renderWidthPx;
      renderHeightPx = body.renderHeightPx;
      pageWidthPt = body.pageWidthPt;
      pageHeightPt = body.pageHeightPt;
      templateId = body.templateId;
      dpi = body.dpi;
    } else {
      // Legacy format: percentages
      fmKey = body.fmKey;
      page = body.page;
      xPct = body.xPct;
      yPct = body.yPct;
      wPct = body.wPct;
      hPct = body.hPct;
      templateId = body.templateId;
      dpi = body.dpi;
    }

    // Validate required fields
    if (!fmKey || typeof fmKey !== "string" || !fmKey.trim()) {
      return NextResponse.json(
        { error: "fmKey is required" },
        { status: 400 }
      );
    }

    if (typeof page !== "number" || page < 1) {
      return NextResponse.json(
        { error: "page must be a number >= 1" },
        { status: 400 }
      );
    }

    if (isNewFormat) {
      // Validate new format fields
      if (!rectPx || typeof rectPx.x !== "number" || typeof rectPx.y !== "number" ||
          typeof rectPx.w !== "number" || typeof rectPx.h !== "number") {
        return NextResponse.json(
          { error: "rectPx must be an object with x, y, w, h numbers" },
          { status: 400 }
        );
      }

      if (typeof renderWidthPx !== "number" || typeof renderHeightPx !== "number" ||
          renderWidthPx <= 0 || renderHeightPx <= 0) {
        return NextResponse.json(
          { error: "renderWidthPx and renderHeightPx must be positive numbers" },
          { status: 400 }
        );
      }

      if (typeof pageWidthPt !== "number" || typeof pageHeightPt !== "number" ||
          pageWidthPt <= 0 || pageHeightPt <= 0) {
        return NextResponse.json(
          { error: "pageWidthPt and pageHeightPt must be positive numbers" },
          { status: 400 }
        );
      }

      // Validate crop zone bounds in pixels
      if (rectPx.x < 0 || rectPx.y < 0 || rectPx.w <= 0 || rectPx.h <= 0) {
        return NextResponse.json(
          { error: "Crop zone must have positive dimensions" },
          { status: 400 }
        );
      }

      if (rectPx.x + rectPx.w > renderWidthPx || rectPx.y + rectPx.h > renderHeightPx) {
        return NextResponse.json(
          { error: "Crop zone is out of bounds" },
          { status: 400 }
        );
      }

      // Convert pixels to PDF points (top-left origin) for validation
      const wPtForValidation = (rectPx.w / renderWidthPx) * pageWidthPt;
      const hPtForValidation = (rectPx.h / renderHeightPx) * pageHeightPt;

      // Validate minimum size in points
      const MIN_W_PT = 8;
      const MIN_H_PT = 8;
      if (wPtForValidation < MIN_W_PT || hPtForValidation < MIN_H_PT) {
        return NextResponse.json(
          { error: "Crop zone is too small. Make the rectangle bigger." },
          { status: 400 }
        );
      }

      // Also compute percentages for backward compatibility
      xPct = rectPx.x / renderWidthPx;
      yPct = rectPx.y / renderHeightPx;
      wPct = rectPx.w / renderWidthPx;
      hPct = rectPx.h / renderHeightPx;
    } else {
      // Legacy format validation
      if (typeof xPct !== "number" || typeof yPct !== "number" || 
          typeof wPct !== "number" || typeof hPct !== "number") {
        return NextResponse.json(
          { error: "xPct, yPct, wPct, hPct must be numbers" },
          { status: 400 }
        );
      }

      // Validate crop zone is not default sentinel (0/0/1/1)
      const TOLERANCE = 0.01;
      const isDefault = Math.abs(xPct) < TOLERANCE && 
                        Math.abs(yPct) < TOLERANCE && 
                        Math.abs(wPct - 1) < TOLERANCE && 
                        Math.abs(hPct - 1) < TOLERANCE;

      if (isDefault) {
        return NextResponse.json(
          { 
            error: "Template crop not configured. Draw a rectangle first.",
            reason: "TEMPLATE_NOT_CONFIGURED"
          },
          { status: 400 }
        );
      }

      // Validate crop zone is not out of bounds
      if (xPct < 0 || yPct < 0 || wPct <= 0 || hPct <= 0 || xPct + wPct > 1 || yPct + hPct > 1) {
        return NextResponse.json(
          { 
            error: "Crop is out of bounds.",
            reason: "INVALID_CROP"
          },
          { status: 400 }
        );
      }

      // Validate crop zone is not too small
      const MIN_W = 0.01;
      const MIN_H = 0.01;
      if (wPct < MIN_W || hPct < MIN_H) {
        return NextResponse.json(
          { 
            error: "Crop is too small. Make the rectangle bigger.",
            reason: "CROP_TOO_SMALL"
          },
          { status: 400 }
        );
      }
    }

    // Sanitize DPI: default 200, clamp 100-400
    let sanitizedDpi = 200;
    if (dpi !== undefined && dpi !== null) {
      const dpiNum = typeof dpi === "number" ? dpi : parseFloat(String(dpi));
      if (!isNaN(dpiNum) && dpiNum > 0) {
        sanitizedDpi = Math.max(100, Math.min(400, Math.round(dpiNum)));
      }
    }

    // Get the main spreadsheet ID from cookie (set during Google step)
    const cookieStore = await cookies();
    const mainSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    if (!mainSpreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not configured. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Ensure Users sheet exists (onboarding route - must ensure sheet exists)
    await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId, { allowEnsure: true });

    // Note: Templates are shared per spreadsheet, not per user, so we don't require a user row
    // The userId is stored for audit purposes but templates work without it
    // We still ensure the Users sheet exists for consistency, but don't fail if user row is missing

    // Save template - use normalizeFmKey for consistent normalization
    const { normalizeFmKey } = await import("@/lib/templates/fmProfiles");
    const normalizedFmKey = normalizeFmKey(fmKey);
    
    // Prepare template data with both legacy percentages and new PDF points
    const templateData: {
      userId: string;
      fmKey: string;
      templateId: string;
      page: number;
      xPct: number;
      yPct: number;
      wPct: number;
      hPct: number;
      dpi?: number;
      // New PDF points fields
      coordSystem?: string;
      pageWidthPt?: number;
      pageHeightPt?: number;
      xPt?: number;
      yPt?: number;
      wPt?: number;
      hPt?: number;
    } = {
      userId: user.userId,
      fmKey: normalizedFmKey,
      templateId: templateId || normalizedFmKey,
      page,
      // Legacy percentages (4 decimals) - kept for backward compatibility
      // When using PDF_POINTS, these are derived from points but not used as source of truth
      xPct: Math.round(xPct! * 10000) / 10000, // Round to 4 decimals (legacy)
      yPct: Math.round(yPct! * 10000) / 10000,
      wPct: Math.round(wPct! * 10000) / 10000,
      hPct: Math.round(hPct! * 10000) / 10000,
      dpi: sanitizedDpi,
    };

    // Add PDF points if available (new format)
    if (isNewFormat && pageWidthPt && pageHeightPt) {
      const xPt = (rectPx!.x / renderWidthPx!) * pageWidthPt;
      const wPt = (rectPx!.w / renderWidthPx!) * pageWidthPt;
      const yPt = (rectPx!.y / renderHeightPx!) * pageHeightPt;
      const hPt = (rectPx!.h / renderHeightPx!) * pageHeightPt;

      // Store as "PDF_POINTS" in sheet (legacy compatibility)
      // Internally we treat this as PDF_POINTS_TOP_LEFT
      templateData.coordSystem = "PDF_POINTS";
      // Points rounded to 2 decimals (minimal rounding for accuracy)
      templateData.pageWidthPt = Math.round(pageWidthPt * 100) / 100;
      templateData.pageHeightPt = Math.round(pageHeightPt * 100) / 100;
      templateData.xPt = Math.round(xPt * 100) / 100;
      templateData.yPt = Math.round(yPt * 100) / 100;
      templateData.wPt = Math.round(wPt * 100) / 100;
      templateData.hPt = Math.round(hPt * 100) / 100;
    }
    
    await upsertTemplate(
      user.googleAccessToken,
      mainSpreadsheetId,
      templateData
    );

    // Invalidate template cache for this spreadsheetId + fmKey
    const { invalidateTemplateCache } = await import("@/lib/workOrders/templateConfig");
    invalidateTemplateCache(mainSpreadsheetId, normalizedFmKey);

    const apiCalls = getApiCallCount();
    console.log(`[onboarding/templates/save] Sheets API calls: ${apiCalls}`);
    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Error saving template:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    
    // Check if it's a duplicate templateId error
    const isDuplicateError = message.includes("already exists") || message.includes("must be unique");
    const statusCode = isDuplicateError ? 400 : 500;
    
    return NextResponse.json(
      { error: message },
      { status: statusCode }
    );
  }
}

