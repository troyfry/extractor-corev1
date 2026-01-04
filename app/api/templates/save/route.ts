import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { upsertTemplateToSheet } from "@/lib/templates/sheetsTemplates";
import { cssPixelsToPdfPoints, validatePdfPoints } from "@/lib/domain/coordinates/pdfPoints";
import type { WorkOrderTemplate } from "@/lib/templates/workOrders";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Plan gating: Pro/Premium only
    const plan = getPlanFromRequest(request);
    if (!hasFeature(plan, "canUseServerKey")) {
      return NextResponse.json(
        { error: "This feature requires Pro or Premium plan" },
        { status: 403 }
      );
    }

    // Get authenticated user
    const user = await getCurrentUser();
    if (!user || !user.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get Google access token
    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google authentication required. Please sign in with Google." },
        { status: 401 }
      );
    }

    // Get workspace (centralized resolution)
    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    // Parse request body
    const body = await request.json();
    const template = body.template as WorkOrderTemplate;

    if (!template || !template.issuerKey || !template.woNumberZone) {
      return NextResponse.json(
        { error: "Invalid template data" },
        { status: 400 }
      );
    }

    const zone = template.woNumberZone;
    const { page } = zone;

    // Validate page
    if (typeof page !== "number" || page < 1) {
      return NextResponse.json(
        { error: "page must be a number >= 1" },
        { status: 400 }
      );
    }

    // POINTS-ONLY: Require PDF points or page geometry for conversion
    // Accept either:
    // 1. PDF points directly (preferred): xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt
    // 2. Percentages + page geometry: xPct, yPct, wPct, hPct + pageWidthPt, pageHeightPt, boundsPt + CSS pixels
    
    const hasPoints = body.xPt !== undefined && body.yPt !== undefined && 
                     body.wPt !== undefined && body.hPt !== undefined &&
                     body.pageWidthPt !== undefined && body.pageHeightPt !== undefined;
    
    const hasPercentages = zone.xPct !== undefined && zone.yPct !== undefined &&
                          zone.wPct !== undefined && zone.hPct !== undefined;
    
    const hasPageGeometry = body.pageWidthPt !== undefined && body.pageHeightPt !== undefined;
    const hasCssPixels = body.rectPx !== undefined && 
                        body.rectPx.x !== undefined && body.rectPx.y !== undefined &&
                        body.rectPx.w !== undefined && body.rectPx.h !== undefined;
    const hasDisplaySize = body.displayedWidth !== undefined && body.displayedHeight !== undefined;
    const hasCanvasSize = body.canvasWidth !== undefined && body.canvasHeight !== undefined;

    let xPt: number;
    let yPt: number;
    let wPt: number;
    let hPt: number;
    let pageWidthPt: number;
    let pageHeightPt: number;

    if (hasPoints) {
      // Use points directly
      xPt = body.xPt;
      yPt = body.yPt;
      wPt = body.wPt;
      hPt = body.hPt;
      pageWidthPt = body.pageWidthPt;
      pageHeightPt = body.pageHeightPt;
    } else if (hasPercentages && hasPageGeometry && hasCssPixels && hasDisplaySize && hasCanvasSize) {
      // Convert percentages to points using conversion function
      pageWidthPt = body.pageWidthPt;
      pageHeightPt = body.pageHeightPt;
      const boundsPt = body.boundsPt ? {
        x0: body.boundsPt.x0,
        y0: body.boundsPt.y0,
        x1: body.boundsPt.x1,
        y1: body.boundsPt.y1,
      } : null;

      // Convert CSS pixels to PDF points
      const pdfPoints = cssPixelsToPdfPoints(
        {
          x: body.rectPx.x,
          y: body.rectPx.y,
          width: body.rectPx.w,
          height: body.rectPx.h,
        },
        { width: body.displayedWidth, height: body.displayedHeight },
        { width: body.canvasWidth, height: body.canvasHeight },
        { width: pageWidthPt, height: pageHeightPt },
        boundsPt
      );

      xPt = pdfPoints.xPt;
      yPt = pdfPoints.yPt;
      wPt = pdfPoints.wPt;
      hPt = pdfPoints.hPt;
    } else {
      return NextResponse.json(
        { 
          error: "PDF points are required. Provide either: (1) xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt directly, or (2) percentages + page geometry (pageWidthPt, pageHeightPt, boundsPt) + CSS pixels (rectPx, displayedWidth/Height, canvasWidth/Height) for conversion.",
          reason: "MISSING_PDF_POINTS"
        },
        { status: 400 }
      );
    }

    // Server-side validation: Validate PDF points
    try {
      validatePdfPoints(
        { xPt, yPt, wPt, hPt },
        { width: pageWidthPt, height: pageHeightPt },
        "template-save"
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

    // Save template to Sheets with PDF points
    // Note: upsertTemplateToSheet currently expects WorkOrderTemplate with percentages
    // We'll update it to accept points, but for now we'll create a modified template
    // TODO: Update upsertTemplateToSheet to accept points directly
    await upsertTemplateToSheet({
      spreadsheetId,
      accessToken: user.googleAccessToken,
      template: {
        ...template,
        // Store points in a way that upsertTemplateToSheet can handle
        // This is a temporary workaround - we'll update upsertTemplateToSheet next
        woNumberZone: {
          ...zone,
          // Add points as additional properties (will be handled by updated upsertTemplateToSheet)
        },
        // Add points to template object for conversion
        pageWidthPt,
        pageHeightPt,
        xPt,
        yPt,
        wPt,
        hPt,
      } as any,
    });

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json({ success: true });
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }
    return response;
  } catch (error) {
    console.error("[Templates Save] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save template" },
      { status: 500 }
    );
  }
}

