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
import { readWorkspaceCookies, rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
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

    const response = NextResponse.json({
      workspace,
      message: "Workspace loaded successfully",
    });

    // Check if cookies need to be set (use cookie module)
    const cookieStore = await cookies();
    const wsCookies = readWorkspaceCookies(cookieStore);
    
    // Only rehydrate if workspace was loaded from Users Sheet or cookies are missing
    if (!wsCookies.workspaceReady || wsCookies.workspaceReady !== "true") {
      rehydrateWorkspaceCookies(response, workspace);
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

