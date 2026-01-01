/**
 * Bootstrap endpoint: returns workspace and sets cookies if needed.
 * 
 * GET /api/workspace/bootstrap
 * 
 * Client calls this once on app load if workspaceReady cookie is missing.
 * Returns workspace config and sets cookies for fast access.
 */

import { NextResponse } from "next/server";
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || !user.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load workspace (cookie-first, then Users Sheet)
    const workspace = await loadWorkspace();

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found. Please complete onboarding." },
        { status: 404 }
      );
    }

    // Set cookies for fast access (even if already set, refresh them)
    const response = NextResponse.json({
      workspace,
      message: "Workspace loaded successfully",
    });

    const cookieStore = await cookies();
    const workspaceReady = cookieStore.get("workspaceReady")?.value;

    // Only set cookies if not already set (avoid unnecessary writes)
    if (workspaceReady !== "true") {
      response.cookies.set("workspaceReady", "true", {
        maxAge: 30 * 24 * 60 * 60, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      response.cookies.set("workspaceSpreadsheetId", workspace.spreadsheetId, {
        maxAge: 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      response.cookies.set("workspaceDriveFolderId", workspace.driveFolderId, {
        maxAge: 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      response.cookies.set("onboardingCompletedAt", workspace.onboardingCompletedAt, {
        maxAge: 30 * 24 * 60 * 60,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
    }

    return response;
  } catch (error) {
    console.error("[Workspace Bootstrap] Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

