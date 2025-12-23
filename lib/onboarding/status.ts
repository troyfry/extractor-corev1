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
 * Checks cookies first (set during onboarding), then session, then Users sheet, then env fallback.
 */
async function getMainSpreadsheetId(
  userId: string,
  accessToken: string
): Promise<string | null> {
  try {
    // First, check cookie (set during onboarding Google step)
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
    
    if (cookieSpreadsheetId) {
      // If we have cookie, try to read Users sheet to get the actual sheetId from user's row
      try {
        const { getUserRowById } = await import("./usersSheet");
        const userRow = await getUserRowById(accessToken, cookieSpreadsheetId, userId);
        if (userRow) {
          // Store mainSpreadsheetId in user row if not already set (for future lookups)
          if (!userRow.mainSpreadsheetId && cookieSpreadsheetId) {
            const { upsertUserRow } = await import("./usersSheet");
            await upsertUserRow(accessToken, cookieSpreadsheetId, {
              ...userRow,
              mainSpreadsheetId: cookieSpreadsheetId,
            });
          }
          // Use mainSpreadsheetId if available, otherwise cookie value
          return userRow.mainSpreadsheetId || cookieSpreadsheetId;
        }
        // If user row doesn't exist yet, use the cookie value (where Users sheet is stored)
        return cookieSpreadsheetId;
      } catch (error) {
        // If reading Users sheet fails, use cookie value
        console.warn("[Onboarding Status] Could not read Users sheet, using cookie value:", error);
        return cookieSpreadsheetId;
      }
    }

    // Second, try session/JWT token
    const session = await auth();
    const sessionSpreadsheetId = session ? (session as any).googleSheetsSpreadsheetId : null;
    let candidateSpreadsheetId = await getUserSpreadsheetId(userId, sessionSpreadsheetId);

    // If we have a candidate from session, try to read Users sheet
    if (candidateSpreadsheetId) {
      try {
        const { getUserRowById } = await import("./usersSheet");
        const userRow = await getUserRowById(accessToken, candidateSpreadsheetId, userId);
        if (userRow) {
          // Use mainSpreadsheetId if available, otherwise candidate
          return userRow.mainSpreadsheetId || candidateSpreadsheetId;
        }
      } catch (error) {
        // If reading Users sheet fails, fall back to candidate
        console.warn("[Onboarding Status] Could not read Users sheet, using session value:", error);
      }
    }

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
 * If user is logged in but doesn't exist in Users sheet, creates a row with onboardingCompleted = "FALSE".
 */
export async function getOnboardingStatus(): Promise<OnboardingStatusResult> {
  const userInfo = await getCurrentUserIdAndEmail();
  if (!userInfo) {
    return {
      isAuthenticated: false,
      onboardingCompleted: false,
    };
  }

  const { userId, email } = userInfo;

  // Get access token
  const user = await getCurrentUser();
  if (!user || !user.googleAccessToken) {
    console.warn("[Onboarding Status] No Google access token available");
    return {
      isAuthenticated: true,
      onboardingCompleted: false,
    };
  }

  // Get spreadsheet ID - check cookie first (set during onboarding), then session/JWT
  let spreadsheetId = await getMainSpreadsheetId(userId, user.googleAccessToken);
  
  // If no spreadsheet ID found, try cookie directly (fallback)
  if (!spreadsheetId) {
    try {
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      spreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;
    } catch (error) {
      console.warn("[Onboarding Status] Could not read cookies:", error);
    }
  }

  // If still no spreadsheet ID, try to get from session/JWT token
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

  try {
    // Ensure Users sheet exists
    await ensureUsersSheet(user.googleAccessToken, spreadsheetId);

    // Get user row
    let userRow = await getUserRowById(user.googleAccessToken, spreadsheetId, userId);

    // If user doesn't exist, create a row with onboardingCompleted = "FALSE"
    if (!userRow) {
      await upsertUserRow(user.googleAccessToken, spreadsheetId, {
        userId,
        email,
        onboardingCompleted: "FALSE",
        sheetId: "",
        mainSpreadsheetId: spreadsheetId, // Store where Users sheet is located
        driveFolderId: "",
        openaiKeyEncrypted: "",
        createdAt: new Date().toISOString(),
      });
      // Re-fetch the row
      userRow = await getUserRowById(user.googleAccessToken, spreadsheetId, userId);
    } else if (!userRow.mainSpreadsheetId && spreadsheetId) {
      // If user exists but doesn't have mainSpreadsheetId, update it
      await upsertUserRow(user.googleAccessToken, spreadsheetId, {
        ...userRow,
        mainSpreadsheetId: spreadsheetId,
      });
      // Re-fetch the row
      userRow = await getUserRowById(user.googleAccessToken, spreadsheetId, userId);
    }

    if (!userRow) {
      // Still null after creation, something went wrong
      return {
        isAuthenticated: true,
        onboardingCompleted: false,
      };
    }

    const onboardingCompleted = userRow.onboardingCompleted === "TRUE";

    return {
      isAuthenticated: true,
      onboardingCompleted,
      userRow,
    };
  } catch (error) {
    console.error("[Onboarding Status] Error checking onboarding status:", error);
    // On error, assume onboarding not completed (safer)
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

  // If still no spreadsheet ID, try to get from Users sheet
  if (!targetSpreadsheetId) {
    targetSpreadsheetId = await getMainSpreadsheetId(userId, user.googleAccessToken);
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

  await setOnboardingCompleted(user.googleAccessToken, targetSpreadsheetId, userId);
}

