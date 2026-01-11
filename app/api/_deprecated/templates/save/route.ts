import { NextResponse } from "next/server";
import { getPlanFromRequest } from "@/lib/_deprecated/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { upsertTemplateToSheet } from "@/lib/templates/sheetsTemplates";
import { cssPixelsToPdfPoints, validatePdfPoints } from "@/lib/_deprecated/domain/coordinates/pdfPoints";
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

    // POINTS-ONLY: Accept only PDF points or CSS pixels + geometry for conversion
    // Accept either:
    // A) Direct PDF points: xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt (and optional boundsPt)
    // B) CSS pixels + geometry: rectPx + displayedWidth/Height + canvasWidth/Height + pageWidthPt/pageHeightPt (+ optional boundsPt)
    
    const hasPoints = body.xPt !== undefined && body.yPt !== undefined && 
                     body.wPt !== undefined && body.hPt !== undefined &&
                     body.pageWidthPt !== undefined && body.pageHeightPt !== undefined;
    
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
    let boundsPt: { x0: number; y0: number; x1: number; y1: number } | null = null;

    if (hasPoints) {
      // Use points directly
      xPt = body.xPt;
      yPt = body.yPt;
      wPt = body.wPt;
      hPt = body.hPt;
      pageWidthPt = body.pageWidthPt;
      pageHeightPt = body.pageHeightPt;
      if (body.boundsPt) {
        boundsPt = {
          x0: body.boundsPt.x0,
          y0: body.boundsPt.y0,
          x1: body.boundsPt.x1,
          y1: body.boundsPt.y1,
        };
      }
    } else if (hasPageGeometry && hasCssPixels && hasDisplaySize && hasCanvasSize) {
      // Convert CSS pixels to PDF points
      pageWidthPt = body.pageWidthPt;
      pageHeightPt = body.pageHeightPt;
      if (body.boundsPt) {
        boundsPt = {
          x0: body.boundsPt.x0,
          y0: body.boundsPt.y0,
          x1: body.boundsPt.x1,
          y1: body.boundsPt.y1,
        };
      }

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
          error: "PDF points are required. Provide either: (1) xPt, yPt, wPt, hPt, pageWidthPt, pageHeightPt directly, or (2) CSS pixels (rectPx) + display size (displayedWidth/Height) + canvas size (canvasWidth/Height) + page geometry (pageWidthPt, pageHeightPt, optional boundsPt) for conversion.",
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

    // Save template to Sheets with PDF points in woNumberZone
    await upsertTemplateToSheet({
      spreadsheetId,
      accessToken: user.googleAccessToken,
      template: {
        ...template,
        woNumberZone: {
          page,
          xPt,
          yPt,
          wPt,
          hPt,
          pageWidthPt,
          pageHeightPt,
          ...(boundsPt && { boundsPt }),
        },
      },
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

