/**
 * Helper functions for loading workspace configuration from the Config tab.
 * 
 * The Config tab stores key/value pairs that include folderId, spreadsheetId, etc.
 * This avoids requiring users to paste IDs during onboarding.
 */

import { createSheetsClient } from "./sheets";

export type WorkspaceConfig = {
  version?: string;
  folderName?: string;
  folderId?: string;
  sheetName?: string;
  spreadsheetId?: string;
  createdAt?: string;
  [key: string]: string | undefined;
};

/**
 * Load workspace configuration from the Config tab in a spreadsheet.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @returns Key/value map of config, or null if Config tab doesn't exist or is empty
 */
export async function loadWorkspaceConfig(
  accessToken: string,
  spreadsheetId: string
): Promise<WorkspaceConfig | null> {
  const sheets = createSheetsClient(accessToken);

  try {
    // Read Config tab (A:B columns)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Config!A:B",
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      // No config data (only header or empty)
      console.log(`[Workspace Config] Config tab is empty or missing data`);
      return null;
    }

    // First row is header (key, value)
    // Subsequent rows are key/value pairs
    const config: WorkspaceConfig = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row.length >= 2 && row[0] && row[1]) {
        const key = String(row[0]).trim();
        const value = String(row[1]).trim();
        if (key && value) {
          config[key] = value;
        }
      }
    }

    console.log(`[Workspace Config] Loaded config from spreadsheet:`, {
      keys: Object.keys(config),
      spreadsheetId: spreadsheetId.substring(0, 10) + "...",
    });

    return config;
  } catch (error) {
    // Config tab might not exist (legacy spreadsheets)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("Unable to parse range") || 
        errorMessage.includes("No data found") ||
        errorMessage.includes("not found")) {
      console.log(`[Workspace Config] Config tab not found (legacy spreadsheet?)`);
      return null;
    }
    
    console.error(`[Workspace Config] Error loading config:`, error);
    throw error;
  }
}

/**
 * Get folderId from workspace config, with fallback to cookie/session.
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param fallbackFolderId Optional fallback folderId (from cookie/session)
 * @returns folderId or null
 */
export async function getFolderIdFromConfig(
  accessToken: string,
  spreadsheetId: string,
  fallbackFolderId?: string | null
): Promise<string | null> {
  const config = await loadWorkspaceConfig(accessToken, spreadsheetId);
  return config?.folderId || fallbackFolderId || null;
}

/**
 * Get spreadsheetId from workspace config (should match the one passed in, but useful for validation).
 * 
 * @param accessToken Google OAuth access token
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @returns spreadsheetId from config or the passed-in one
 */
export async function getSpreadsheetIdFromConfig(
  accessToken: string,
  spreadsheetId: string
): Promise<string | null> {
  const config = await loadWorkspaceConfig(accessToken, spreadsheetId);
  return config?.spreadsheetId || spreadsheetId;
}

