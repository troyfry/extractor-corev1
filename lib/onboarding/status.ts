/**
 * Onboarding status helper.
 * 
 * Checks and manages user onboarding status from the Users sheet.
 */

import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import {
  ensureUsersSheet,
  getUserRowById,
  upsertUserRow,
  setOnboardingCompleted,
  resetApiCallCount,
  getApiCallCount,
  type UserRow,
} from "./usersSheet";
import { auth } from "@/auth";

/**
 * Get current user ID and email from session.
 */
export async function getCurrentUserIdAndEmail(): Promise<{
  userId: string;
  email: string;
} | null> {
  const user = await getCurrentUser();
  if (!user || !user.userId || !user.email) {
    return null;
  }

  return {
    userId: user.userId,
    email: user.email,
  };
}

/**
 * Get the main spreadsheet ID for the current user.
 * Checks cookies first (set during onboarding), then session, then env fallback.
 * 
 * Do not call Google Sheets in getMainSpreadsheetId. Cookie/session only.
 * This prevents quota errors during /pro page renders.
 */
async function getMainSpreadsheetId(
  userId: string
): Promise<string | null> {
  try {
    // First, check cookie (set during onboarding Google step)
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
    
    if (cookieSpreadsheetId) {
      return cookieSpreadsheetId;
    }

    // Second, try session/JWT token
    const session = await auth();
    const sessionSpreadsheetId = session ? (session as any).googleSheetsSpreadsheetId : null;
    const candidateSpreadsheetId = await getUserSpreadsheetId(userId, sessionSpreadsheetId);

    return candidateSpreadsheetId;
  } catch (error) {
    console.error("[Onboarding Status] Error getting spreadsheet ID:", error);
    return null;
  }
}

/**
 * Onboarding status result.
 */
export type OnboardingStatusResult = {
  isAuthenticated: boolean;
  onboardingCompleted: boolean;
  userRow?: UserRow;
};

/**
 * Get onboarding status for the current user.
 * 
 * If user is not logged in, returns { isAuthenticated: false, onboardingCompleted: false }.
 * 
 * Strategy:
 * 1. Check onboardingCompleted cookie FIRST - returns immediately if true (no Sheets calls)
 * 2. If cookie missing, attempt ONE Sheets read (no ensureUsersSheet)
 * 3. Handle quota errors gracefully
 */
export async function getOnboardingStatus(): Promise<OnboardingStatusResult> {
  // STEP 1: Check onboardingCompleted cookie FIRST (no API calls, no token needed)
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
    
    if (cookieOnboardingCompleted === "true") {
      console.log("[Onboarding Status] Cookie indicates onboarding completed - returning without Sheets calls");
      return {
        isAuthenticated: true,
        onboardingCompleted: true,
      };
    }
  } catch (error) {
    console.warn("[Onboarding Status] Could not read cookies:", error);
  }

  // STEP 2: If cookie not set, check authentication and get user info
  const userInfo = await getCurrentUserIdAndEmail();
  if (!userInfo) {
    return {
      isAuthenticated: false,
      onboardingCompleted: false,
    };
  }

  const { userId, email } = userInfo;

  // Get access token (needed for Sheets read if cookie missing)
  const user = await getCurrentUser();
  if (!user || !user.googleAccessToken) {
    console.warn("[Onboarding Status] No Google access token available");
    return {
      isAuthenticated: true,
      onboardingCompleted: false,
    };
  }

  // STEP 3: Get spreadsheet ID (lightweight - cookie/session only, no Sheets calls)
  let spreadsheetId: string | null = null;
  
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    spreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
  } catch (error) {
    console.warn("[Onboarding Status] Could not read cookies:", error);
  }

  if (!spreadsheetId) {
    try {
      const session = await auth();
      spreadsheetId = session ? (session as any).googleSheetsSpreadsheetId : null;
    } catch (error) {
      console.warn("[Onboarding Status] Could not read session:", error);
    }
  }

  if (!spreadsheetId) {
    console.warn("[Onboarding Status] No spreadsheet ID configured - user needs to complete Google Sheets setup");
    return {
      isAuthenticated: true,
      onboardingCompleted: false,
    };
  }

  // STEP 4: Attempt ONE Sheets read (no ensureUsersSheet)
  try {
    resetApiCallCount();
    
    // Get user row (uses cache, does NOT call ensureUsersSheet)
    const userRow = await getUserRowById(user.googleAccessToken, spreadsheetId, userId);

    if (!userRow) {
      // User doesn't exist in sheet - assume not completed
      // Don't create row here (only in onboarding routes)
      return {
        isAuthenticated: true,
        onboardingCompleted: false,
      };
    }

    const onboardingCompleted = userRow.onboardingCompleted === "TRUE";
    const apiCalls = getApiCallCount();
    console.log(`[Onboarding Status] Sheets API calls: ${apiCalls}, completed: ${onboardingCompleted}`);

    return {
      isAuthenticated: true,
      onboardingCompleted,
      userRow,
    };
  } catch (error: any) {
    // Check if it's a quota error
    const isQuotaError = error?.code === 429 || 
                        error?.status === 429 ||
                        error?.message?.includes("quota") ||
                        error?.message?.includes("rate limit") ||
                        error?.message?.includes("Read requests per minute");
    
    if (isQuotaError) {
      console.warn("[Onboarding Status] Quota error, falling back to cookie/session check:", error.message);
      // Return not completed but don't throw - let UI show message
      return {
        isAuthenticated: true,
        onboardingCompleted: false,
      };
    }
    
    console.error("[Onboarding Status] Error checking onboarding status:", error);
    // On other errors, assume onboarding not completed (safer)
    return {
      isAuthenticated: true,
      onboardingCompleted: false,
    };
  }
}

/**
 * Mark onboarding as completed for the current user.
 * 
 * @param spreadsheetId - Optional spreadsheet ID. If not provided, will try to get from cookie or user row.
 */
export async function completeOnboarding(spreadsheetId?: string): Promise<void> {
  resetApiCallCount();
  
  const userInfo = await getCurrentUserIdAndEmail();
  if (!userInfo) {
    throw new Error("User not authenticated");
  }

  const { userId } = userInfo;

  // Get access token
  const user = await getCurrentUser();
  if (!user || !user.googleAccessToken) {
    throw new Error("Google access token not available");
  }

  // Get spreadsheet ID - prefer provided, then cookie, then try to get from Users sheet
  let targetSpreadsheetId = spreadsheetId;
  
  if (!targetSpreadsheetId) {
    // Try to get from cookie (set during Google step)
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    targetSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
  }

  // If still no spreadsheet ID, try to get from cookie/session (no Sheets calls)
  if (!targetSpreadsheetId) {
    targetSpreadsheetId = await getMainSpreadsheetId(userId);
  }

  // If still no spreadsheet ID, try to get from user's row in Users sheet
  // We need a spreadsheet ID to read Users sheet, so try session/cookie first
  if (!targetSpreadsheetId) {
    const session = await auth();
    const sessionSpreadsheetId = session ? (session as any).googleSheetsSpreadsheetId : null;
    const candidateSpreadsheetId = await getUserSpreadsheetId(userId, sessionSpreadsheetId);
    
    if (candidateSpreadsheetId) {
      // Try to read Users sheet to get the actual sheetId from user's row
      try {
        const userRow = await getUserRowById(user.googleAccessToken, candidateSpreadsheetId, userId);
        if (userRow && userRow.sheetId) {
          targetSpreadsheetId = userRow.sheetId;
        } else {
          // Use the candidate spreadsheet ID (where Users sheet is stored)
          targetSpreadsheetId = candidateSpreadsheetId;
        }
      } catch (error) {
        // If reading Users sheet fails, use candidate
        console.warn("[Complete Onboarding] Could not read Users sheet, using candidate:", error);
        targetSpreadsheetId = candidateSpreadsheetId;
      }
    }
  }

  if (!targetSpreadsheetId) {
    throw new Error("Spreadsheet ID not configured. Please complete the Google Sheets setup step first.");
  }

  // Ensure Users sheet exists (onboarding route - must ensure sheet exists)
  await ensureUsersSheet(user.googleAccessToken, targetSpreadsheetId);

  // Validate prerequisites before completing onboarding
  const userRow = await getUserRowById(user.googleAccessToken, targetSpreadsheetId, userId);
  if (!userRow) {
    throw new Error("User row not found. Please complete the Google Sheets setup step first.");
  }

  // Check that sheetId and driveFolderId are set
  if (!userRow.sheetId || !userRow.driveFolderId) {
    throw new Error("Google Sheets and Drive folder must be configured before completing onboarding.");
  }

  // Check that at least one FM profile exists
  const { getAllFmProfiles } = await import("@/lib/templates/fmProfilesSheets");
  const fmProfiles = await getAllFmProfiles({
    spreadsheetId: targetSpreadsheetId,
    accessToken: user.googleAccessToken,
  });
  
  // Filter profiles for this user (check userId field if present, or assume all are for this user if userId column doesn't exist)
  const userFmProfiles = fmProfiles.filter(p => {
    // If profile has userId property, check it matches
    // Otherwise, assume it's for this user (legacy profiles without userId)
    return !(p as any).userId || (p as any).userId === userId;
  });

  if (userFmProfiles.length === 0) {
    throw new Error("At least one FM profile must be configured before completing onboarding.");
  }

  // Check that at least one template crop zone exists
  const { listTemplatesForUser } = await import("@/lib/templates/templatesSheets");
  const templates = await listTemplatesForUser(
    user.googleAccessToken,
    targetSpreadsheetId,
    userId
  );

  if (templates.length === 0) {
    throw new Error("Before automation can run, set the Work Order Number crop zone for at least one FM template. Please complete the Templates step.");
  }

  // Validate templates are not default (0/0/1/1)
  const validTemplates = templates.filter(t => {
    const TOLERANCE = 0.01;
    return !(
      Math.abs(t.xPct) < TOLERANCE &&
      Math.abs(t.yPct) < TOLERANCE &&
      Math.abs(t.wPct - 1) < TOLERANCE &&
      Math.abs(t.hPct - 1) < TOLERANCE
    );
  });

  if (validTemplates.length === 0) {
    throw new Error("At least one template must have a valid crop zone (not the default full-page). Please configure template crop zones.");
  }

  await setOnboardingCompleted(user.googleAccessToken, targetSpreadsheetId, userId);
}

