/**
 * Repository for user settings.
 * 
 * NOTE: User settings are stored in session/JWT tokens and cookies, not a database.
 * This file provides helpers to read/write settings from session only.
 */

import { auth } from "@/auth";

/**
 * Get user's Google Sheets spreadsheet ID.
 * Checks in this order:
 * 1. Session/JWT token (preferred - no DB storage)
 * 2. process.env.GOOGLE_SHEETS_SPREADSHEET_ID (fallback for dev/local)
 * 
 * @param userId - User ID from Google OAuth 'sub' claim (optional if checking session)
 * @param sessionSpreadsheetId - Spreadsheet ID from session (optional, will fetch if not provided)
 * @returns Spreadsheet ID or null
 */
export async function getUserSpreadsheetId(
  userId?: string,
  sessionSpreadsheetId?: string | null
): Promise<string | null> {
  // First, check explicitly passed session spreadsheet ID (preferred - no DB storage)
  if (sessionSpreadsheetId !== undefined) {
    return sessionSpreadsheetId || null;
  }
  
  // Try to get from session/JWT token if available
  try {
    const session = await auth();
    if (session && (session as any).googleSheetsSpreadsheetId) {
      return (session as any).googleSheetsSpreadsheetId;
    }
  } catch (error) {
    // Session not available, continue to fallback
  }
  
  // Note: Cookies are checked in API routes via request.cookies.get()
  // This function focuses on session/JWT fallbacks

  // Final fallback to env var for backward compatibility (dev/local)
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null;
}

/**
 * Save or update user's Google Sheets spreadsheet ID.
 * 
 * NOTE: This function no longer stores to database. Settings are stored in session/cookies.
 * This is a compatibility stub that returns the value.
 * 
 * @param userId - User ID from Google OAuth 'sub' claim
 * @param spreadsheetId - Google Sheets spreadsheet ID (can be null to clear)
 * @param options - Options for storage (ignored - no DB storage)
 * @returns Updated settings
 */
export async function saveUserSpreadsheetId(
  userId: string,
  spreadsheetId: string | null,
  options?: { storeInDatabase?: boolean }
): Promise<{ userId: string; googleSheetsSpreadsheetId: string | null }> {
  // Settings are stored in session/cookies, not database
  // Return the value (will be stored in session via API route)
  return {
    userId,
    googleSheetsSpreadsheetId: spreadsheetId,
  };
}

/**
 * Get all user settings.
 * 
 * NOTE: This function no longer reads from database. Settings are in session/cookies.
 * This is a compatibility stub.
 * 
 * @param userId - User ID from Google OAuth 'sub' claim
 * @returns User settings or null if not found
 */
export async function getUserSettings(userId: string): Promise<{
  userId: string;
  googleSheetsSpreadsheetId: string | null;
} | null> {
  // Settings are stored in session/cookies, not database
  // Try to get from session
  try {
    const session = await auth();
    if (session && (session as any).googleSheetsSpreadsheetId) {
      return {
        userId,
        googleSheetsSpreadsheetId: (session as any).googleSheetsSpreadsheetId,
      };
    }
  } catch (error) {
    // Session not available
  }

  return null;
}
