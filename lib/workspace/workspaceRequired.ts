/**
 * Workspace resolution helper for API routes.
 * 
 * This function ensures that a workspace is configured before proceeding.
 * Returns a standardized error response if workspace is not found.
 * 
 * @returns WorkspaceResult (never null) or throws NextResponse for error
 */

import { NextResponse } from "next/server";
import { getWorkspace, type WorkspaceResult } from "./getWorkspace";

/**
 * Get workspace configuration, returning error response if not found.
 * 
 * @returns WorkspaceResult with workspace (never null)
 * @throws NextResponse with 401/400 status if workspace not configured
 */
export async function workspaceRequired(): Promise<
  Exclude<WorkspaceResult, null>
> {
  const result = await getWorkspace();
  
  if (!result) {
    throw NextResponse.json(
      { error: "Workspace not configured" },
      { status: 401 }
    );
  }
  
  return result;
}

