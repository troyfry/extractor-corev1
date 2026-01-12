/**
 * FM Profile persistence in Google Sheets.
 * 
 * Stores FM profiles in "FM_Profiles" tab of the user's Google Sheet.
 * Each row represents a profile for a specific fmKey.
 */

import { createSheetsClient } from "@/lib/google/sheets";
import type { FmProfile } from "./fmProfiles";
import { getErrorMessage } from "@/lib/utils/error";
import { getColumnRange } from "@/lib/google/sheetsCache";

/**
 * Required columns for FM Profile storage in Google Sheets.
 */
const FM_PROFILE_COLUMNS = [
  "userId",
  "fmKey",
  "fmLabel",
  "page",
  "xPct",
  "yPct",
  "wPct",
  "hPct",
  "senderDomains",
  "subjectKeywords",
  "updated_at",
] as const;

/**
 * Format sheet name for Google Sheets API range.
 */
function formatSheetRange(sheetName: string, range: string = "1:1"): string {
  if (/[\s'"]/.test(sheetName)) {
    return `'${sheetName.replace(/'/g, "''")}'!${range}`;
  }
  return `${sheetName}!${range}`;
}

/**
 * Ensure the "FM_Profiles" tab exists with required headers.
 */
export async function ensureFmProfileSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "FM_Profiles";

  try {
    // Get spreadsheet metadata to check if sheet exists
    const spreadsheetResponse = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheetExists = spreadsheetResponse.data.sheets?.some(
      (sheet) => sheet.properties?.title === sheetName
    );

    // Create sheet if it doesn't exist
    if (!sheetExists) {
      console.log(`[FM Profiles] Creating "${sheetName}" sheet`);
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: sheetName,
                  },
                },
              },
            ],
          },
        });
        console.log(`[FM Profiles] Created "${sheetName}" sheet`);
      } catch (createError: any) {
        // Handle case where sheet was created between check and create (race condition)
        const errorMessage = getErrorMessage(createError);
        if (errorMessage.includes("already exists") || errorMessage.includes("duplicate")) {
          console.log(`[FM Profiles] Sheet "${sheetName}" already exists (race condition), continuing...`);
        } else {
          // Re-throw if it's a different error
          throw createError;
        }
      }
    } else {
      console.log(`[FM Profiles] Sheet "${sheetName}" already exists`);
    }

    // Get current header row
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "1:1"),
    });

    const existingHeaders = (headerResponse.data.values?.[0] || []) as string[];
    const existingHeadersLower = existingHeaders.map((h) => h.toLowerCase().trim());

    // Find missing columns
    const missingColumns: string[] = [];
    for (const col of FM_PROFILE_COLUMNS) {
      if (!existingHeadersLower.includes(col.toLowerCase())) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length === 0) {
      console.log(`[FM Profiles] "${sheetName}" sheet is ready`);
      return;
    }

    // Add missing columns to the header row
    const updatedHeaders = [...existingHeaders, ...missingColumns];

    // Update the header row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: formatSheetRange(sheetName, "1:1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [updatedHeaders],
      },
    });

    console.log(`[FM Profiles] Added ${missingColumns.length} missing columns to "${sheetName}" sheet`);
  } catch (error) {
    console.error(`[FM Profiles] Error ensuring FM profile sheet:`, error);
    throw error;
  }
}

/**
 * Write or update an FM profile in Google Sheets.
 * Uses fmKey as the unique identifier (one row per spreadsheetId + fmKey).
 * Profiles are shared per spreadsheet, not per user.
 * userId is stored for audit purposes but not used for uniqueness.
 */
export async function upsertFmProfile(params: {
  spreadsheetId: string;
  accessToken: string;
  profile: FmProfile;
  userId?: string; // Optional, stored for audit but not used for uniqueness
}): Promise<void> {
  const { spreadsheetId, accessToken, profile, userId } = params;
  const sheets = createSheetsClient(accessToken);
  const sheetName = "FM_Profiles";

  // Ensure sheet exists with headers
  await ensureFmProfileSheet(spreadsheetId, accessToken);

  try {
    // Get all data to find existing row by fmKey only (profiles are shared per spreadsheet)
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(FM_PROFILE_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      // No data, just append
      await appendFmProfileRow(sheets, spreadsheetId, sheetName, profile, userId);
      return;
    }

    // Find row index by fmKey only (profiles are shared per spreadsheet, not per user)
    const headers = rows[0] as string[];
    const fmKeyColIndex = headers.findIndex(
      (h) => h.toLowerCase().trim() === "fmkey"
    );

    if (fmKeyColIndex === -1) {
      // fmKey column not found, just append
      await appendFmProfileRow(sheets, spreadsheetId, sheetName, profile, userId);
      return;
    }

    // Find existing row by fmKey only (profiles are shared per spreadsheet, not per user)
    let existingRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      
      const rowFmKey = (row[fmKeyColIndex] || "").trim().toLowerCase();
      const profileFmKey = profile.fmKey.trim().toLowerCase();
      
      // Match by fmKey only
      if (rowFmKey === profileFmKey) {
        existingRowIndex = i + 1; // +1 because Sheets is 1-indexed
        break;
      }
    }

    if (existingRowIndex === -1) {
      // Row doesn't exist, append it
      await appendFmProfileRow(sheets, spreadsheetId, sheetName, profile, userId);
    } else {
      // Row exists, update it
      await updateFmProfileRow(sheets, spreadsheetId, sheetName, existingRowIndex, profile, userId);
    }
  } catch (error) {
    console.error(`[FM Profiles] Error upserting profile:`, error);
    throw error;
  }
}

/**
 * Get all FM profiles from Google Sheets.
 */
export async function getAllFmProfiles(params: {
  spreadsheetId: string;
  accessToken: string;
}): Promise<FmProfile[]> {
  const { spreadsheetId, accessToken } = params;
  const sheets = createSheetsClient(accessToken);
  const sheetName = "FM_Profiles";

  try {
    // Try to ensure sheet exists first (will create if missing, but won't fail if it exists)
    // If this fails due to auth issues, we'll catch it below
    try {
      await ensureFmProfileSheet(spreadsheetId, accessToken);
    } catch (ensureError: unknown) {
      // If sheet doesn't exist and we can't create it, try to read anyway (maybe it exists)
      // But if it's an auth error, re-throw it
      const errorMessage = getErrorMessage(ensureError);
      if (errorMessage.includes("Invalid Credentials") || 
          errorMessage.includes("unauthorized") ||
          errorMessage.includes("authentication")) {
        console.error(`[FM Profiles] Authentication error ensuring sheet:`, errorMessage);
        throw ensureError;
      }
      // For other errors (like sheet not found), try to read anyway
      console.warn(`[FM Profiles] Could not ensure sheet exists, trying to read anyway:`, errorMessage);
    }

    // Get all data
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(FM_PROFILE_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0 || rows.length === 1) {
      // Only headers or empty - no profiles
      console.log(`[FM Profiles] No profiles found in "${sheetName}" sheet`);
      return [];
    }

    const headers = rows[0] as string[];
    const profiles: FmProfile[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Skip empty rows
      if (!row || row.every(cell => !cell || String(cell).trim() === "")) {
        continue;
      }
      const profile = parseFmProfileFromRow(row, headers);
      if (profile) {
        profiles.push(profile);
      }
    }

    console.log(`[FM Profiles] Loaded ${profiles.length} profile(s) from "${sheetName}" sheet`);
    return profiles;
  } catch (error: unknown) {
    console.error(`[FM Profiles] Error getting profiles:`, error);
    
    // Check if it's an authentication/authorization error
    const errorMessage = getErrorMessage(error);
    const errorCode = (error as { code?: number })?.code;
    if (errorMessage.includes("Invalid Credentials") || 
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("authentication") ||
        errorCode === 401 ||
        errorCode === 403) {
      throw new Error("Google authentication expired or invalid. Please sign out and sign in again.");
    }
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Delete an FM profile from Google Sheets by clearing the row.
 */
export async function deleteFmProfile(params: {
  spreadsheetId: string;
  accessToken: string;
  fmKey: string;
}): Promise<void> {
  const { spreadsheetId, accessToken, fmKey } = params;
  const sheets = createSheetsClient(accessToken);
  const sheetName = "FM_Profiles";

  try {
    // Get all data to find row by fmKey
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(FM_PROFILE_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return;
    }

    const headers = rows[0] as string[];
    const fmKeyColIndex = headers.findIndex(
      (h) => h.toLowerCase().trim() === "fmkey"
    );

    if (fmKeyColIndex === -1) {
      return;
    }

    // Find row by fmKey
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[fmKeyColIndex] === fmKey) {
        const rowIndex = i + 1; // +1 because Sheets is 1-indexed
        // Clear the row by setting all cells to empty
        const emptyRow = new Array(headers.length).fill("");
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
          valueInputOption: "RAW",
          requestBody: {
            values: [emptyRow],
          },
        });
        console.log(`[FM Profiles] Deleted profile: ${fmKey}`);
        return;
      }
    }
  } catch (error) {
    console.error(`[FM Profiles] Error deleting profile:`, error);
    throw error;
  }
}

/**
 * Append a new FM profile row to Google Sheets.
 */
async function appendFmProfileRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  profile: FmProfile,
  userId?: string
): Promise<void> {
  // Get headers to determine column order
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  // Build row data in the correct column order
  const rowData: string[] = new Array(headers.length).fill("");

  // Map profile fields to columns
  const profileData: Record<string, string> = {
    fmKey: profile.fmKey,
    fmLabel: profile.fmLabel,
    page: String(profile.page),
    xPct: String(profile.xPct),
    yPct: String(profile.yPct),
    wPct: String(profile.wPct),
    hPct: String(profile.hPct),
    senderDomains: profile.senderDomains || "",
    subjectKeywords: profile.subjectKeywords || "",
    updated_at: new Date().toISOString(),
  };

  for (const col of FM_PROFILE_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && profileData[col] !== undefined) {
      rowData[index] = profileData[col];
    }
  }

  console.log(`[FM Profiles] Appending profile for fmKey: ${profile.fmKey}`);

  // Append row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, getColumnRange(FM_PROFILE_COLUMNS.length)),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[FM Profiles] Appended profile: ${profile.fmKey}`);
}

/**
 * Update an existing FM profile row in Google Sheets.
 */
async function updateFmProfileRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  profile: FmProfile,
  userId?: string
): Promise<void> {
  // Get headers to determine column order
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  // Get existing row to preserve values
  const existingRowResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
  });

  const existingRow = (existingRowResponse.data.values?.[0] || []) as string[];
  const rowData: string[] = [...existingRow];

  // Extend rowData if needed
  while (rowData.length < headers.length) {
    rowData.push("");
  }

  // Map profile fields to columns (only update provided fields)
  const profileData: Record<string, string> = {};
  if (userId !== undefined) profileData.userId = userId;
  profileData.fmKey = profile.fmKey;
  profileData.fmLabel = profile.fmLabel;
  profileData.page = String(profile.page);
  profileData.xPct = String(profile.xPct);
  profileData.yPct = String(profile.yPct);
  profileData.wPct = String(profile.wPct);
  profileData.hPct = String(profile.hPct);
  profileData.senderDomains = profile.senderDomains || "";
  profileData.subjectKeywords = profile.subjectKeywords || "";
  profileData.updated_at = new Date().toISOString();

  for (const col of FM_PROFILE_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && profileData[col] !== undefined) {
      rowData[index] = profileData[col];
    }
  }

  console.log(`[FM Profiles] Updating profile row ${rowIndex} for fmKey: ${profile.fmKey}`);

  // Update row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[FM Profiles] Updated profile: ${profile.fmKey}`);
}

/**
 * Parse an FM profile from a Sheets row.
 */
function parseFmProfileFromRow(
  row: string[],
  headers: string[]
): FmProfile | undefined {
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  const getValue = (colName: string): string | undefined => {
    const index = headersLower.indexOf(colName.toLowerCase());
    return index !== -1 && row[index] ? String(row[index]).trim() : undefined;
  };

  const fmKey = getValue("fmKey");
  const fmLabel = getValue("fmLabel");
  const page = getValue("page");
  const xPct = getValue("xPct");
  const yPct = getValue("yPct");
  const wPct = getValue("wPct");
  const hPct = getValue("hPct");
  const senderDomains = getValue("senderDomains");
  const subjectKeywords = getValue("subjectKeywords");

  if (!fmKey || !fmLabel || !page || !xPct || !yPct || !wPct || !hPct) {
    return undefined;
  }

  try {
    const profile: FmProfile = {
      fmKey,
      fmLabel,
      page: parseInt(page, 10),
      xPct: parseFloat(xPct),
      yPct: parseFloat(yPct),
      wPct: parseFloat(wPct),
      hPct: parseFloat(hPct),
      senderDomains: senderDomains || undefined,
      subjectKeywords: subjectKeywords || undefined,
    };

    // Validate values
    if (
      isNaN(profile.page) ||
      isNaN(profile.xPct) ||
      isNaN(profile.yPct) ||
      isNaN(profile.wPct) ||
      isNaN(profile.hPct)
    ) {
      return undefined;
    }

    return profile;
  } catch (error) {
    console.warn(`[FM Profiles] Error parsing profile row:`, error);
    return undefined;
  }
}

