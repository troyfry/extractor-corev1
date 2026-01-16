/**
 * API route for saving template crop zones during onboarding.
 * 
 * POST /api/onboarding/templates/save
 * Body: { fmKey: string, page: number, xPt: number, yPt: number, wPt: number, hPt: number, pageWidthPt: number, pageHeightPt: number, templateId?: string }
 * 
 * ⚠️ POINTS-ONLY: This route rejects any payload containing xPct/yPct/wPct/hPct fields.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { resetApiCallCount, getApiCallCount, ensureUsersSheet } from "@/lib/onboarding/usersSheet";
import { upsertTemplate as upsertTemplateSheets } from "@/lib/templates/templatesSheets";
import { cookies } from "next/headers";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getWorkspaceById } from "@/lib/db/services/workspace";
import { upsertFmProfile } from "@/lib/db/services/fmProfiles";

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
    
    // Use domain layer for region validation
    const { validateTemplateRegion, normalizeTemplateRegion, validatePdfForTemplateCapture } = await import("@/lib/templates");
    
    // Validate region using domain layer
    let normalizedRegion;
    try {
      validateTemplateRegion(body);
      normalizedRegion = normalizeTemplateRegion(body);
    } catch (validationError) {
      const errorMessage = validationError instanceof Error ? validationError.message : "Invalid template region";
      return NextResponse.json(
        { 
          error: errorMessage,
          reason: validationError instanceof Error && errorMessage.includes("Percentage") 
            ? "PERCENTAGE_FIELDS_REJECTED" 
            : "INVALID_TEMPLATE_REGION"
        },
        { status: 400 }
      );
    }

    // Extract fields from normalized region
    const { xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt } = normalizedRegion;
    
    // Extract other fields
    const fmKey = body.fmKey;
    const page = body.page;
    const templateId = body.templateId;
    const dpi = body.dpi;
    const pdfBufferBase64 = body.pdfBuffer; // Optional: PDF buffer for raster detection
    const originalFilename = body.originalFilename || body.filename; // Optional: filename for validation

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

    // Get workspace ID (DB-native)
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Get workspace to check if export is enabled
    const workspace = await getWorkspaceById(workspaceId);
    const exportEnabled = workspace?.export_enabled === true;
    const mainSpreadsheetId = workspace?.spreadsheet_id || null;

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

    // Save to DB first (update FM profile with wo_number_region)
    // POINTS-ONLY: Store only PDF points, not percentages
    const woNumberRegion = {
      page,
      xPt,
      yPt,
      wPt,
      hPt,
      pageWidthPt,
      pageHeightPt,
      dpi: sanitizedDpi,
      // Percentage fields omitted - points-only mode
    };

    await upsertFmProfile({
      workspaceId,
      fmKey: normalizedFmKey,
      woNumberRegion,
    });
    
    console.log(`[onboarding/templates/save] ✅ Saved template to DB for fmKey="${normalizedFmKey}"`);
    
    // ⚠️ SERVER-SIDE VALIDATION: Block signed/scan PDFs by filename (even if no buffer provided)
    // This prevents bypassing client-side checks
    try {
      const allowRasterOverride = body.allowRasterOverride === true; // Debug flag from client
      
      // Step 1: Validate filename if provided (always check, even without buffer)
      if (originalFilename && typeof originalFilename === "string") {
        await validatePdfForTemplateCapture(undefined, { 
          filename: originalFilename,
          allowRasterOverride 
        });
      }
      
      // Step 2: Validate PDF buffer if provided (raster detection)
      if (pdfBufferBase64) {
        const pdfBuffer = Buffer.from(pdfBufferBase64, "base64");
        await validatePdfForTemplateCapture(pdfBuffer, { 
          filename: originalFilename,
          allowRasterOverride 
        });
      }
    } catch (validationError) {
      const errorMessage = validationError instanceof Error ? validationError.message : "PDF validation failed";
      const reason = errorMessage.includes("Signed scans") 
        ? "SIGNED_PDF_REJECTED" 
        : "RASTER_ONLY_PDF_REJECTED";
      
      return NextResponse.json(
        {
          error: errorMessage,
          reason
        },
        { status: 400 }
      );
    }

    // Use normalized region from domain layer (already rounded)
    const templateData: {
      userId: string;
      fmKey: string;
      templateId: string;
      page: number;
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
      dpi: sanitizedDpi,
      // PDF points (source of truth) - saved in explicit x,y,w,h order to named columns
      coordSystem: "PDF_POINTS",
      // Use normalized region values (already rounded to 2 decimals)
      pageWidthPt: normalizedRegion.pageWidthPt,
      pageHeightPt: normalizedRegion.pageHeightPt,
      xPt: normalizedRegion.xPt,
      yPt: normalizedRegion.yPt,
      wPt: normalizedRegion.wPt,
      hPt: normalizedRegion.hPt,
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
      spreadsheetId: mainSpreadsheetId ? mainSpreadsheetId.substring(0, 10) + "..." : "null",
    });
    
    // Get the exact rowData that will be written (for logging)
    // Only if export is enabled and spreadsheet ID exists
    let rowDataLog = null;
    if (exportEnabled && mainSpreadsheetId) {
      try {
        const { getTemplateRowDataForLogging } = await import("@/lib/templates/templatesSheets");
        rowDataLog = await getTemplateRowDataForLogging(
          user.googleAccessToken,
          mainSpreadsheetId,
          templateData
        );
      } catch (logError) {
        console.warn("[onboarding/templates/save] Failed to get row data for logging:", logError);
      }
    }
    
    // If export is enabled, also save to Sheets
    if (exportEnabled && mainSpreadsheetId) {
      try {
        // Ensure Users sheet exists
        await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId, { allowEnsure: true });

        await upsertTemplateSheets(
          user.googleAccessToken,
          mainSpreadsheetId,
          templateData
        );
        
        console.log(`[onboarding/templates/save] ✅ Saved template to Sheets for fmKey="${normalizedFmKey}"`);
        console.log(`[onboarding/templates/save] Exact rowData written to Sheets:`, rowDataLog);

        // Invalidate template cache for this spreadsheetId + fmKey
        const { invalidateTemplateCache } = await import("@/lib/workOrders/templateConfig");
        invalidateTemplateCache(mainSpreadsheetId, normalizedFmKey);
      } catch (sheetsError) {
        // Log but don't fail - DB is the source of truth
        console.warn(`[onboarding/templates/save] Failed to save template to Sheets (non-blocking):`, sheetsError);
      }
    }

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

/**
 * DELETE /api/onboarding/templates/save?fmKey=...
 * Delete a template by fmKey.
 * 
 * Rules:
 * - Only deletes if template exists (returns 404 if not found)
 * - No cascade deletion (FM profile remains)
 * - Invalidates template cache after deletion
 */
export async function DELETE(request: Request) {
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

    // Get fmKey from query params
    const { searchParams } = new URL(request.url);
    const fmKey = searchParams.get("fmKey");

    if (!fmKey) {
      return NextResponse.json(
        { error: "fmKey query parameter is required" },
        { status: 400 }
      );
    }

    // Get spreadsheet ID
    const cookieStore = await cookies();
    const mainSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    if (!mainSpreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not configured. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Delete template
    const { deleteTemplate } = await import("@/lib/templates/templatesSheets");
    const deleted = await deleteTemplate(
      user.googleAccessToken,
      mainSpreadsheetId,
      fmKey
    );

    if (!deleted) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Invalidate template cache
    const { invalidateTemplateCache } = await import("@/lib/workOrders/templateConfig");
    const { normalizeFmKey } = await import("@/lib/templates/fmProfiles");
    invalidateTemplateCache(mainSpreadsheetId, normalizeFmKey(fmKey));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting template:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

