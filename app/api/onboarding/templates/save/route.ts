/**
 * API route for saving template crop zones during onboarding.
 * 
 * POST /api/onboarding/templates/save
 * Body: { fmKey: string, page: number, xPct: number, yPct: number, wPct: number, hPct: number, templateId?: string }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById, resetApiCallCount, getApiCallCount, ensureUsersSheet } from "@/lib/onboarding/usersSheet";
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
    
    const { fmKey, page, xPct, yPct, wPct, hPct, templateId, dpi } = body;

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
    await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId);

    // Verify user row exists
    const userRow = await getUserRowById(user.googleAccessToken, mainSpreadsheetId, user.userId);
    if (!userRow) {
      return NextResponse.json(
        { error: "User row not found. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Save template
    await upsertTemplate(
      user.googleAccessToken,
      mainSpreadsheetId,
      {
        userId: user.userId,
        fmKey: fmKey.toLowerCase().trim(),
        templateId: templateId || fmKey.toLowerCase().trim(),
        page,
        xPct: Math.round(xPct * 10000) / 10000, // Round to 4 decimals
        yPct: Math.round(yPct * 10000) / 10000,
        wPct: Math.round(wPct * 10000) / 10000,
        hPct: Math.round(hPct * 10000) / 10000,
        dpi: sanitizedDpi,
      }
    );

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

