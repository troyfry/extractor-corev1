/**
 * Rehydrate cookies from workspace data.
 * 
 * This is called when workspace is loaded from Users Sheet to set cookies
 * for faster access on subsequent requests.
 */

import { cookies } from "next/headers";
import type { UserWorkspace } from "./types";

/**
 * Set workspace cookies from workspace data.
 * This makes subsequent requests faster (cookie path).
 */
export async function rehydrateCookies(workspace: UserWorkspace): Promise<void> {
  const cookieStore = await cookies();
  
  cookieStore.set("googleSheetsSpreadsheetId", workspace.spreadsheetId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });
  
  cookieStore.set("googleDriveFolderId", workspace.driveSignedFolderId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
  });
  
  cookieStore.set("onboardingCompleted", "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
  });
  
  cookieStore.set("workspaceReady", "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
  });
}

