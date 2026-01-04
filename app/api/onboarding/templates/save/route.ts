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
    
    // PDF_POINTS only: require points directly (computed client-side using viewport conversion)
    // Also accept rectPx for validation/debugging
    const hasPoints = body.xPt !== undefined && body.yPt !== undefined && 
                     body.wPt !== undefined && body.hPt !== undefined &&
                     body.pageWidthPt !== undefined && body.pageHeightPt !== undefined;
    
    if (!hasPoints) {
      return NextResponse.json(
        { error: "PDF_POINTS format required: xPt, yPt, wPt, hPt, pageWidthPt, and pageHeightPt are required" },
        { status: 400 }
      );
    }
    
    let fmKey: string;
    let page: number;
    let xPt: number;
    let yPt: number;
    let wPt: number;
    let hPt: number;
    let pageWidthPt: number;
    let pageHeightPt: number;
    let templateId: string | undefined;
    let dpi: number | undefined;
    let rectPx: { x: number; y: number; w: number; h: number } | undefined;
    let renderWidthPx: number | undefined;
    let renderHeightPx: number | undefined;

    // PDF_POINTS format - points are computed client-side using viewport conversion
    fmKey = body.fmKey;
    page = body.page;
    xPt = body.xPt;
    yPt = body.yPt;
    wPt = body.wPt;
    hPt = body.hPt;
    pageWidthPt = body.pageWidthPt;
    pageHeightPt = body.pageHeightPt;
    templateId = body.templateId;
    dpi = body.dpi;
    // Optional: rectPx for validation/debugging
    rectPx = body.rectPx;
    renderWidthPx = body.renderWidthPx;
    renderHeightPx = body.renderHeightPx;

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
    
    console.log(`[onboarding/templates/save] Normalizing fmKey:`, {
      rawFmKey: fmKey,
      normalizedFmKey,
    });
    
    // Points are already computed client-side using viewport.convertToPdfPoint()
    // Validate they're finite and in correct x,y,w,h order
    console.log(`[onboarding/templates/save] Received points from client:`, {
      xPt,
      yPt,
      wPt,
      hPt,
      pageWidthPt,
      pageHeightPt,
    });
    
    // Server-side validation: Use centralized validatePdfPoints function
    try {
      const { validatePdfPoints } = await import("@/lib/domain/coordinates/pdfPoints");
      validatePdfPoints(
        { xPt, yPt, wPt, hPt },
        { width: pageWidthPt, height: pageHeightPt },
        "template"
      );
    } catch (validationError) {
      return NextResponse.json(
        { 
          error: validationError instanceof Error ? validationError.message : "Invalid PDF points",
          reason: "INVALID_PDF_POINTS"
        },
        { status: 400 }
      );
    }

    const templateData: {
      userId: string;
      fmKey: string;
      templateId: string;
      page: number;
      xPct: string; // Set to "" to avoid accidental fallback
      yPct: string;
      wPct: string;
      hPct: string;
      dpi?: number;
      coordSystem: string;
      pageWidthPt: number;
      pageHeightPt: number;
      xPt: number;
      yPt: number;
      wPt: number;
      hPt: number;
    } = {
      userId: user.userId,
      fmKey: normalizedFmKey, // Always save normalized fmKey
      templateId: templateId || normalizedFmKey,
      page,
      // Legacy pct columns: set to "" to avoid future accidental fallback
      // Points are the only source of truth
      xPct: "",
      yPct: "",
      wPct: "",
      hPct: "",
      dpi: sanitizedDpi,
      // PDF points (source of truth) - saved in explicit x,y,w,h order to named columns
      coordSystem: "PDF_POINTS",
      // Points rounded to 2 decimals (minimal rounding for accuracy)
      pageWidthPt: Math.round(pageWidthPt * 100) / 100,
      pageHeightPt: Math.round(pageHeightPt * 100) / 100,
      // Explicit x,y,w,h order - saved to named columns (xPt, yPt, wPt, hPt)
      xPt: Math.round(xPt * 100) / 100,
      yPt: Math.round(yPt * 100) / 100,
      wPt: Math.round(wPt * 100) / 100,
      hPt: Math.round(hPt * 100) / 100,
    };
    
    console.log(`[onboarding/templates/save] Computed points before saving (x,y,w,h order):`, {
      xPt: templateData.xPt,
      yPt: templateData.yPt,
      wPt: templateData.wPt,
      hPt: templateData.hPt,
      pageWidthPt: templateData.pageWidthPt,
      pageHeightPt: templateData.pageHeightPt,
    });
    
    console.log(`[onboarding/templates/save] Saving template row (POINTS-ONLY):`, {
      normalizedFmKey: templateData.fmKey,
      templateId: templateData.templateId,
      page: templateData.page,
      coordSystem: templateData.coordSystem,
      points: {
        xPt: templateData.xPt,
        yPt: templateData.yPt,
        wPt: templateData.wPt,
        hPt: templateData.hPt,
        pageWidthPt: templateData.pageWidthPt,
        pageHeightPt: templateData.pageHeightPt,
      },
      dpi: templateData.dpi,
      pctFields: "set to empty string (points-only mode)",
      spreadsheetId: mainSpreadsheetId.substring(0, 10) + "...",
    });
    
    // Get the exact rowData that will be written (for logging)
    const { getTemplateRowDataForLogging } = await import("@/lib/templates/templatesSheets");
    const rowDataLog = await getTemplateRowDataForLogging(
      user.googleAccessToken,
      mainSpreadsheetId,
      templateData
    );
    
    await upsertTemplate(
      user.googleAccessToken,
      mainSpreadsheetId,
      templateData
    );
    
    console.log(`[onboarding/templates/save] Template saved successfully for normalizedFmKey="${normalizedFmKey}"`);
    console.log(`[onboarding/templates/save] Exact rowData written to Sheets:`, rowDataLog);

    // Invalidate template cache for this spreadsheetId + fmKey
    const { invalidateTemplateCache } = await import("@/lib/workOrders/templateConfig");
    invalidateTemplateCache(mainSpreadsheetId, normalizedFmKey);

    const apiCalls = getApiCallCount();
    console.log(`[onboarding/templates/save] Sheets API calls: ${apiCalls}`);
    
    // Template saved successfully - don't mark onboarding complete here
    // User can add multiple templates, then click "Go to Dashboard" when ready
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

