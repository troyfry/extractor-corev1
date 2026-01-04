/**
 * Workspace cookie management.
 * 
 * SINGLE SOURCE OF TRUTH for all workspace cookie operations.
 * 
 * Rules:
 * - Cookies are read-only in route handlers (use NextResponse.cookies for writing)
 * - All cookie reads go through readWorkspaceCookies()
 * - All cookie writes go through rehydrateWorkspaceCookies() or clearWorkspaceCookies()
 * - Never read/write cookies directly in API routes
 */

import { cookies } from "next/headers";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { NextResponse } from "next/server";
import type { UserWorkspace } from "./types";
import type { WorkspaceConfig } from "@/types/workspace";

/**
 * Workspace version for cookie validation.
 * Increment this when workspace structure changes.
 */
export const WORKSPACE_VERSION = "2.0";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 30 * 24 * 60 * 60, // 30 days
};

/**
 * Workspace cookie values read from cookies.
 */
export type WorkspaceCookies = {
  workspaceVersion?: string;
  workspaceReady?: string;
  spreadsheetId?: string;
  folderId?: string;
  onboardingCompleted?: string;
  onboardingCompletedAt?: string;
  // Gmail labels
  gmailWorkOrdersLabelName?: string;
  gmailWorkOrdersLabelId?: string;
  gmailSignedLabelName?: string;
  gmailSignedLabelId?: string;
  gmailProcessedLabelName?: string;
  gmailProcessedLabelId?: string;
};

/**
 * Read workspace cookies from cookie store.
 * 
 * @param cookieStore - Cookie store (from cookies() or passed in)
 * @returns Workspace cookie values
 */
export function readWorkspaceCookies(
  cookieStore: ReadonlyRequestCookies
): WorkspaceCookies {
  return {
    workspaceVersion: cookieStore.get("workspaceVersion")?.value,
    workspaceReady: cookieStore.get("workspaceReady")?.value,
    spreadsheetId: cookieStore.get("workspaceSpreadsheetId")?.value ||
                   cookieStore.get("googleSheetsSpreadsheetId")?.value, // Legacy
    folderId: cookieStore.get("workspaceDriveFolderId")?.value ||
              cookieStore.get("googleDriveFolderId")?.value, // Legacy
    onboardingCompleted: cookieStore.get("onboardingCompleted")?.value,
    onboardingCompletedAt: cookieStore.get("onboardingCompletedAt")?.value,
    gmailWorkOrdersLabelName: cookieStore.get("gmailWorkOrdersLabelName")?.value,
    gmailWorkOrdersLabelId: cookieStore.get("gmailWorkOrdersLabelId")?.value,
    gmailSignedLabelName: cookieStore.get("gmailSignedLabelName")?.value,
    gmailSignedLabelId: cookieStore.get("gmailSignedLabelId")?.value,
    gmailProcessedLabelName: cookieStore.get("gmailProcessedLabelName")?.value,
    gmailProcessedLabelId: cookieStore.get("gmailProcessedLabelId")?.value,
  };
}

/**
 * Rehydrate workspace cookies in a NextResponse.
 * 
 * This sets all workspace-related cookies for fast access on subsequent requests.
 * Call this when workspace is loaded from Users Sheet (source of truth).
 * 
 * @param response - NextResponse to set cookies on
 * @param workspace - Workspace data to write to cookies
 */
export function rehydrateWorkspaceCookies(
  response: NextResponse,
  workspace: UserWorkspace | WorkspaceConfig
): void {
  // Set version for validation
  response.cookies.set("workspaceVersion", WORKSPACE_VERSION, COOKIE_OPTIONS);
  response.cookies.set("workspaceReady", "true", COOKIE_OPTIONS);
  
  // Core workspace data
  response.cookies.set("workspaceSpreadsheetId", workspace.spreadsheetId, COOKIE_OPTIONS);
  
  // Legacy cookies for backward compatibility
  response.cookies.set("googleSheetsSpreadsheetId", workspace.spreadsheetId, COOKIE_OPTIONS);
  response.cookies.set("onboardingCompleted", "true", COOKIE_OPTIONS);
  
  // Drive folder (if available)
  const folderId = "driveFolderId" in workspace 
    ? workspace.driveFolderId 
    : ("driveSignedFolderId" in workspace ? workspace.driveSignedFolderId : "");
  
  if (folderId) {
    response.cookies.set("workspaceDriveFolderId", folderId, COOKIE_OPTIONS);
    response.cookies.set("googleDriveFolderId", folderId, COOKIE_OPTIONS); // Legacy
  }
  
  // Onboarding timestamp
  const completedAt = "onboardingCompletedAt" in workspace
    ? workspace.onboardingCompletedAt
    : ("updatedAt" in workspace ? workspace.updatedAt : new Date().toISOString());
  
  response.cookies.set("onboardingCompletedAt", completedAt, COOKIE_OPTIONS);
  
  // Gmail labels (if available in WorkspaceConfig)
  if ("gmailWorkOrdersLabelName" in workspace && workspace.gmailWorkOrdersLabelName) {
    response.cookies.set("gmailWorkOrdersLabelName", workspace.gmailWorkOrdersLabelName, COOKIE_OPTIONS);
  }
  if ("gmailWorkOrdersLabelId" in workspace && workspace.gmailWorkOrdersLabelId) {
    response.cookies.set("gmailWorkOrdersLabelId", workspace.gmailWorkOrdersLabelId, COOKIE_OPTIONS);
  }
  if ("gmailSignedLabelName" in workspace && workspace.gmailSignedLabelName) {
    response.cookies.set("gmailSignedLabelName", workspace.gmailSignedLabelName, COOKIE_OPTIONS);
  }
  if ("gmailSignedLabelId" in workspace && workspace.gmailSignedLabelId) {
    response.cookies.set("gmailSignedLabelId", workspace.gmailSignedLabelId, COOKIE_OPTIONS);
  }
  if ("gmailProcessedLabelName" in workspace && workspace.gmailProcessedLabelName) {
    response.cookies.set("gmailProcessedLabelName", workspace.gmailProcessedLabelName, COOKIE_OPTIONS);
  }
  if ("gmailProcessedLabelId" in workspace && workspace.gmailProcessedLabelId) {
    response.cookies.set("gmailProcessedLabelId", workspace.gmailProcessedLabelId, COOKIE_OPTIONS);
  }
}

/**
 * Clear all workspace cookies.
 * 
 * Call this when workspace is reset or user logs out.
 * 
 * @param response - NextResponse to clear cookies on
 */
export function clearWorkspaceCookies(response: NextResponse): void {
  const cookieNames = [
    "workspaceVersion",
    "workspaceReady",
    "workspaceSpreadsheetId",
    "workspaceDriveFolderId",
    "googleSheetsSpreadsheetId", // Legacy
    "googleDriveFolderId", // Legacy
    "onboardingCompleted",
    "onboardingCompletedAt",
    "gmailWorkOrdersLabelName",
    "gmailWorkOrdersLabelId",
    "gmailSignedLabelName",
    "gmailSignedLabelId",
    "gmailProcessedLabelName",
    "gmailProcessedLabelId",
  ];
  
  for (const name of cookieNames) {
    response.cookies.delete(name);
  }
}

/**
 * Validate workspace version from cookies.
 * 
 * @param cookieStore - Cookie store to read from
 * @returns true if version matches or is missing (legacy), false if version mismatch
 */
export function validateWorkspaceVersion(
  cookieStore: ReadonlyRequestCookies
): boolean {
  const cookieVersion = cookieStore.get("workspaceVersion")?.value;
  
  // Missing version = legacy cookies (allow for backward compatibility)
  if (!cookieVersion) {
    return true;
  }
  
  // Version mismatch = invalid (need to reload from Users Sheet)
  return cookieVersion === WORKSPACE_VERSION;
}

