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
  workspaceId?: string; // DB-native workspace ID
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
    workspaceId: cookieStore.get("workspaceId")?.value, // DB-native
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
 * Call this when workspace is loaded from DB (source of truth) or Users Sheet (legacy).
 * 
 * @param response - NextResponse to set cookies on
 * @param workspace - Workspace data to write to cookies (UserWorkspace, WorkspaceConfig, or DB workspace)
 */
export function rehydrateWorkspaceCookies(
  response: NextResponse,
  workspace: UserWorkspace | WorkspaceConfig | { 
    id: string;
    spreadsheet_id: string | null;
    drive_folder_id: string;
    onboarding_completed_at: Date | null;
    gmail_base_label_name?: string | null;
    gmail_queue_label_id?: string | null;
    gmail_signed_label_id?: string | null;
    gmail_processed_label_id?: string | null;
  }
): void {
  // Set version for validation
  response.cookies.set("workspaceVersion", WORKSPACE_VERSION, COOKIE_OPTIONS);
  response.cookies.set("workspaceReady", "true", COOKIE_OPTIONS);
  
  // Check if this is DB workspace format
  const isDbWorkspace = "id" in workspace && "drive_folder_id" in workspace;
  
  if (isDbWorkspace) {
    // DB workspace format
    const dbWorkspace = workspace as { 
      id: string;
      spreadsheet_id: string | null;
      drive_folder_id: string;
      onboarding_completed_at: Date | null;
      gmail_base_label_name?: string | null;
      gmail_queue_label_id?: string | null;
      gmail_signed_label_id?: string | null;
      gmail_processed_label_id?: string | null;
    };
    
    // Set workspace ID cookie (DB-native)
    response.cookies.set("workspaceId", dbWorkspace.id, COOKIE_OPTIONS);
    
    // Set spreadsheet ID (only if export enabled)
    if (dbWorkspace.spreadsheet_id) {
      response.cookies.set("workspaceSpreadsheetId", dbWorkspace.spreadsheet_id, COOKIE_OPTIONS);
      response.cookies.set("googleSheetsSpreadsheetId", dbWorkspace.spreadsheet_id, COOKIE_OPTIONS); // Legacy
    }
    
    // Set drive folder ID
    response.cookies.set("workspaceDriveFolderId", dbWorkspace.drive_folder_id, COOKIE_OPTIONS);
    response.cookies.set("googleDriveFolderId", dbWorkspace.drive_folder_id, COOKIE_OPTIONS); // Legacy
    
    // Set onboarding status
    if (dbWorkspace.onboarding_completed_at) {
      response.cookies.set("onboardingCompleted", "true", COOKIE_OPTIONS);
      response.cookies.set("onboardingCompletedAt", dbWorkspace.onboarding_completed_at.toISOString(), COOKIE_OPTIONS);
    }
    
    // Set Gmail labels (if available)
    if (dbWorkspace.gmail_queue_label_id) {
      response.cookies.set("gmailWorkOrdersLabelId", dbWorkspace.gmail_queue_label_id, COOKIE_OPTIONS);
      if (dbWorkspace.gmail_base_label_name) {
        response.cookies.set("gmailWorkOrdersLabelName", dbWorkspace.gmail_base_label_name, COOKIE_OPTIONS);
      }
    }
    if (dbWorkspace.gmail_signed_label_id) {
      response.cookies.set("gmailSignedLabelId", dbWorkspace.gmail_signed_label_id, COOKIE_OPTIONS);
      if (dbWorkspace.gmail_base_label_name) {
        response.cookies.set("gmailSignedLabelName", dbWorkspace.gmail_base_label_name, COOKIE_OPTIONS);
      }
    }
    if (dbWorkspace.gmail_processed_label_id) {
      response.cookies.set("gmailProcessedLabelId", dbWorkspace.gmail_processed_label_id, COOKIE_OPTIONS);
      if (dbWorkspace.gmail_base_label_name) {
        response.cookies.set("gmailProcessedLabelName", dbWorkspace.gmail_base_label_name, COOKIE_OPTIONS);
      }
    }
  } else {
    // Legacy format (UserWorkspace | WorkspaceConfig)
    const legacyWorkspace = workspace as UserWorkspace | WorkspaceConfig;
    
    // Core workspace data
    if (legacyWorkspace.spreadsheetId) {
      response.cookies.set("workspaceSpreadsheetId", legacyWorkspace.spreadsheetId, COOKIE_OPTIONS);
      response.cookies.set("googleSheetsSpreadsheetId", legacyWorkspace.spreadsheetId, COOKIE_OPTIONS); // Legacy
    }
    response.cookies.set("onboardingCompleted", "true", COOKIE_OPTIONS);
    
    // Drive folder (if available)
    const folderId = "driveFolderId" in legacyWorkspace 
      ? legacyWorkspace.driveFolderId 
      : ("driveSignedFolderId" in legacyWorkspace ? legacyWorkspace.driveSignedFolderId : "");
    
    if (folderId) {
      response.cookies.set("workspaceDriveFolderId", folderId, COOKIE_OPTIONS);
      response.cookies.set("googleDriveFolderId", folderId, COOKIE_OPTIONS); // Legacy
    }
    
    // Onboarding timestamp
    const completedAt = "onboardingCompletedAt" in legacyWorkspace
      ? legacyWorkspace.onboardingCompletedAt
      : ("updatedAt" in legacyWorkspace ? legacyWorkspace.updatedAt : new Date().toISOString());
    
    response.cookies.set("onboardingCompletedAt", completedAt, COOKIE_OPTIONS);
    
    // Gmail labels (if available in WorkspaceConfig)
    if ("gmailWorkOrdersLabelName" in legacyWorkspace && legacyWorkspace.gmailWorkOrdersLabelName) {
      response.cookies.set("gmailWorkOrdersLabelName", legacyWorkspace.gmailWorkOrdersLabelName, COOKIE_OPTIONS);
    }
    if ("gmailWorkOrdersLabelId" in legacyWorkspace && legacyWorkspace.gmailWorkOrdersLabelId) {
      response.cookies.set("gmailWorkOrdersLabelId", legacyWorkspace.gmailWorkOrdersLabelId, COOKIE_OPTIONS);
    }
    if ("gmailSignedLabelName" in legacyWorkspace && legacyWorkspace.gmailSignedLabelName) {
      response.cookies.set("gmailSignedLabelName", legacyWorkspace.gmailSignedLabelName, COOKIE_OPTIONS);
    }
    if ("gmailSignedLabelId" in legacyWorkspace && legacyWorkspace.gmailSignedLabelId) {
      response.cookies.set("gmailSignedLabelId", legacyWorkspace.gmailSignedLabelId, COOKIE_OPTIONS);
    }
    if ("gmailProcessedLabelName" in legacyWorkspace && legacyWorkspace.gmailProcessedLabelName) {
      response.cookies.set("gmailProcessedLabelName", legacyWorkspace.gmailProcessedLabelName, COOKIE_OPTIONS);
    }
    if ("gmailProcessedLabelId" in legacyWorkspace && legacyWorkspace.gmailProcessedLabelId) {
      response.cookies.set("gmailProcessedLabelId", legacyWorkspace.gmailProcessedLabelId, COOKIE_OPTIONS);
    }
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
    "workspaceId", // DB-native
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
  
  // Version mismatch = invalid (need to reload from DB workspace config)
  return cookieVersion === WORKSPACE_VERSION;
}

