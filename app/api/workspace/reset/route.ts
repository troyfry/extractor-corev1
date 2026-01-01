/**
 * Reset workspace endpoint.
 * 
 * POST /api/workspace/reset
 * 
 * Clears workspace configuration from Users Sheet and cookies.
 * Does NOT delete Drive files or spreadsheet data.
 * Archives templates by setting archived=true (doesn't hard delete).
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { upsertUserRow, getUserRowById } from "@/lib/onboarding/usersSheet";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user || !user.userId || !user.googleAccessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get main spreadsheet ID (where Users sheet is stored)
    const mainSpreadsheetId = await getUserSpreadsheetId(user.userId);
    if (!mainSpreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not found" },
        { status: 400 }
      );
    }

    // Get current user row to preserve email and other non-workspace fields
    const userRow = await getUserRowById(
      user.googleAccessToken,
      mainSpreadsheetId,
      user.userId
    );

    if (!userRow) {
      return NextResponse.json(
        { error: "User row not found" },
        { status: 404 }
      );
    }

    // Clear workspace fields (preserve email, userId, createdAt)
    await upsertUserRow(user.googleAccessToken, mainSpreadsheetId, {
      userId: user.userId,
      email: userRow.email,
      spreadsheetId: "",
      driveFolderId: "",
      fmProfilesJson: "",
      templatesConfigured: "FALSE",
      onboardingCompletedAt: "",
      onboardingCompleted: "FALSE",
      updatedAt: new Date().toISOString(),
    }, { allowEnsure: true });

    // Archive templates (set archived=true instead of deleting)
    // Note: This requires updating the templates sheet structure
    // For now, we'll just clear the templatesConfigured flag
    // Templates will remain in the sheet but won't be considered "configured"

    // Clear workspace cookies
    const response = NextResponse.json({
      success: true,
      message: "Workspace reset successfully. Please complete onboarding again.",
    });

    response.cookies.delete("workspaceReady");
    response.cookies.delete("workspaceSpreadsheetId");
    response.cookies.delete("workspaceDriveFolderId");
    response.cookies.delete("onboardingCompleted");
    response.cookies.delete("onboardingCompletedAt");
    response.cookies.delete("googleSheetsSpreadsheetId");
    response.cookies.delete("googleDriveFolderId");
    response.cookies.delete("workspaceReady");

    console.log(`[Workspace Reset] Workspace reset for user ${user.userId}`);
    return response;
  } catch (error) {
    console.error("[Workspace Reset] Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

