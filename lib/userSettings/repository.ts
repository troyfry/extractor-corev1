/**
 * Repository for user settings.
 * Handles reading and writing per-user configuration settings.
 * 
 * Supports both session-based (JWT) and database storage for spreadsheet ID.
 * Session storage is preferred for privacy (no user data in DB).
 */

import { db } from "@/db/client";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";

/**
 * Get user's Google Sheets spreadsheet ID.
 * Checks in this order:
 * 1. Session/JWT token (preferred - no DB storage)
 * 2. Database (if exists)
 * 3. process.env.GOOGLE_SHEETS_SPREADSHEET_ID (fallback for dev/local)
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
    // Session not available, continue to DB check
  }
  
  // Note: Cookies are checked in API routes via request.cookies.get()
  // This function focuses on session/JWT and DB fallbacks

  // Fallback to database if userId provided
  if (userId) {
    try {
      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

      if (settings.length > 0 && settings[0].googleSheetsSpreadsheetId) {
        return settings[0].googleSheetsSpreadsheetId;
      }
    } catch (error) {
      console.error("[UserSettings] Error getting spreadsheet ID from DB:", error);
    }
  }

  // Final fallback to env var for backward compatibility (dev/local)
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null;
}

/**
 * Save or update user's Google Sheets spreadsheet ID.
 * 
 * By default, stores in session (JWT token) only - no database storage.
 * Set `storeInDatabase: true` to also persist to database.
 * 
 * @param userId - User ID from Google OAuth 'sub' claim
 * @param spreadsheetId - Google Sheets spreadsheet ID (can be null to clear)
 * @param options - Options for storage
 * @returns Updated settings
 */
export async function saveUserSpreadsheetId(
  userId: string,
  spreadsheetId: string | null,
  options?: { storeInDatabase?: boolean }
): Promise<{ userId: string; googleSheetsSpreadsheetId: string | null }> {
  const storeInDatabase = options?.storeInDatabase ?? false;

  // Store in database only if explicitly requested
  if (storeInDatabase) {
    try {
      // Check if settings exist
      const existing = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        const updated = await db
          .update(userSettings)
          .set({
            googleSheetsSpreadsheetId: spreadsheetId,
            updatedAt: new Date(),
          })
          .where(eq(userSettings.userId, userId))
          .returning();

        return {
          userId: updated[0].userId,
          googleSheetsSpreadsheetId: updated[0].googleSheetsSpreadsheetId ?? null,
        };
      } else {
        // Insert new
        const inserted = await db
          .insert(userSettings)
          .values({
            userId,
            googleSheetsSpreadsheetId: spreadsheetId,
          })
          .returning();

        return {
          userId: inserted[0].userId,
          googleSheetsSpreadsheetId: inserted[0].googleSheetsSpreadsheetId ?? null,
        };
      }
    } catch (error) {
      console.error("[UserSettings] Error saving spreadsheet ID to DB:", error);
      throw error;
    }
  }

  // Default: return the value (will be stored in session via API route)
  return {
    userId,
    googleSheetsSpreadsheetId: spreadsheetId,
  };
}

/**
 * Get all user settings.
 * 
 * @param userId - User ID from Google OAuth 'sub' claim
 * @returns User settings or null if not found
 */
export async function getUserSettings(userId: string): Promise<{
  userId: string;
  googleSheetsSpreadsheetId: string | null;
} | null> {
  try {
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    if (settings.length === 0) {
      return null;
    }

    return {
      userId: settings[0].userId,
      googleSheetsSpreadsheetId: settings[0].googleSheetsSpreadsheetId ?? null,
    };
  } catch (error) {
    console.error("[UserSettings] Error getting user settings:", error);
    return null;
  }
}

