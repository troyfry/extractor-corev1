/**
 * Users sheet helper for onboarding persistence.
 * 
 * Stores user onboarding data in a "Users" tab in Google Sheets.
 * This is the single source of truth for user onboarding status.
 */

import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";

/**
 * Required columns for Users sheet.
 */
const USERS_SHEET_COLUMNS = [
  "userId",
  "email",
  "onboardingCompleted",
  "sheetId",
  "mainSpreadsheetId", // The spreadsheet where this Users sheet is stored
  "driveFolderId",
  "openaiKeyEncrypted",
  "createdAt",
] as const;

/**
 * User row type matching the Users sheet structure.
 */
export type UserRow = {
  userId: string;
  email: string;
  onboardingCompleted: "TRUE" | "FALSE" | "";
  sheetId: string | "";
  mainSpreadsheetId: string | ""; // The spreadsheet where this Users sheet is stored
  driveFolderId: string | "";
  openaiKeyEncrypted: string | "";
  createdAt: string | "";
};

/**
 * Ensure the "Users" tab exists with required headers.
 */
export async function ensureUsersSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Users";

  try {
    // Get spreadsheet metadata to check if sheet exists
    // This will fail with 404 if spreadsheet doesn't exist or user doesn't have access
    const spreadsheetResponse = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheetExists = spreadsheetResponse.data.sheets?.some(
      (sheet) => sheet.properties?.title === sheetName
    );

    // Create sheet if it doesn't exist
    if (!sheetExists) {
      console.log(`[Users Sheet] Creating "${sheetName}" sheet`);
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
      console.log(`[Users Sheet] Created "${sheetName}" sheet`);
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
    for (const col of USERS_SHEET_COLUMNS) {
      if (!existingHeadersLower.includes(col.toLowerCase())) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length === 0) {
      console.log(`[Users Sheet] "${sheetName}" sheet is ready`);
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

    console.log(`[Users Sheet] Added ${missingColumns.length} missing columns to "${sheetName}" sheet`);
  } catch (error: any) {
    console.error(`[Users Sheet] Error ensuring Users sheet:`, error);
    
    // Provide more helpful error messages
    if (error?.code === 404 || error?.status === 404) {
      throw new Error(
        `Spreadsheet not found (ID: ${spreadsheetId}). ` +
        `Please verify the spreadsheet ID is correct and the spreadsheet exists.`
      );
    }
    
    if (error?.code === 403 || error?.status === 403) {
      throw new Error(
        `Access denied to spreadsheet (ID: ${spreadsheetId}). ` +
        `Please ensure the spreadsheet is shared with your Google account and you have edit access.`
      );
    }
    
    // Re-throw with original error message if it's already a helpful error
    if (error instanceof Error && error.message.includes("Spreadsheet")) {
      throw error;
    }
    
    // For other errors, wrap with context
    throw new Error(
      `Failed to access spreadsheet: ${error?.message || "Unknown error"}. ` +
      `Please verify the spreadsheet ID and your access permissions.`
    );
  }
}

/**
 * Get a user row by userId from the Users sheet.
 */
export async function getUserRowById(
  accessToken: string,
  spreadsheetId: string,
  userId: string
): Promise<UserRow | null> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Users";

  try {
    // Ensure sheet exists first
    await ensureUsersSheet(accessToken, spreadsheetId);

    // Get all data
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "A:Z"),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return null;
    }

    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => h.toLowerCase().trim());

    // Find userId column index
    const userIdColIndex = headersLower.indexOf("userid");
    if (userIdColIndex === -1) {
      return null;
    }

    // Find row with matching userId
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[userIdColIndex] === userId) {
        // Build UserRow from row
        const userRow: Partial<UserRow> = {};
        for (const col of USERS_SHEET_COLUMNS) {
          const colIndex = headersLower.indexOf(col.toLowerCase());
          if (colIndex !== -1 && row[colIndex] !== undefined) {
            const value = row[colIndex];
            (userRow as any)[col] = value === "" ? "" : value;
          } else {
            (userRow as any)[col] = "";
          }
        }
        return userRow as UserRow;
      }
    }

    return null;
  } catch (error) {
    console.error(`[Users Sheet] Error getting user row:`, error);
    throw error;
  }
}

/**
 * Upsert a user row in the Users sheet.
 * If userId exists, updates the row; otherwise appends a new row.
 */
export async function upsertUserRow(
  accessToken: string,
  spreadsheetId: string,
  user: Partial<UserRow> & { userId: string; email: string }
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Users";

  // Ensure sheet exists
  await ensureUsersSheet(accessToken, spreadsheetId);

  try {
    // Get all data to find existing row by userId
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "A:Z"),
    });

    const rows = allDataResponse.data.values || [];
    const headers = rows.length > 0 ? (rows[0] as string[]) : [];
    const headersLower = headers.map((h) => h.toLowerCase().trim());

    // Find userId column index
    const userIdColIndex = headersLower.indexOf("userid");
    if (userIdColIndex === -1) {
      // No userId column yet, just append
      await appendUserRow(sheets, spreadsheetId, sheetName, user);
      return;
    }

    // Find existing row by userId
    let existingRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[userIdColIndex] === user.userId) {
        existingRowIndex = i + 1; // +1 because Sheets is 1-indexed
        break;
      }
    }

    if (existingRowIndex === -1) {
      // Row doesn't exist, append it
      await appendUserRow(sheets, spreadsheetId, sheetName, user);
    } else {
      // Row exists, update it
      await updateUserRow(sheets, spreadsheetId, sheetName, existingRowIndex, user);
    }
  } catch (error) {
    console.error(`[Users Sheet] Error upserting user row:`, error);
    throw error;
  }
}

/**
 * Set onboardingCompleted to "TRUE" for a user.
 */
export async function setOnboardingCompleted(
  accessToken: string,
  spreadsheetId: string,
  userId: string
): Promise<void> {
  const userRow = await getUserRowById(accessToken, spreadsheetId, userId);
  if (!userRow) {
    throw new Error(`User ${userId} not found in Users sheet`);
  }

  await upsertUserRow(accessToken, spreadsheetId, {
    ...userRow,
    onboardingCompleted: "TRUE",
  });
}

/**
 * Append a new user row to the Users sheet.
 */
async function appendUserRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  user: Partial<UserRow> & { userId: string; email: string }
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

  // Map user fields to columns
  const now = new Date().toISOString();
  const userData: Record<string, string> = {
    userId: user.userId,
    email: user.email,
    onboardingCompleted: user.onboardingCompleted || "FALSE",
    sheetId: user.sheetId || "",
    mainSpreadsheetId: user.mainSpreadsheetId || "",
    driveFolderId: user.driveFolderId || "",
    openaiKeyEncrypted: user.openaiKeyEncrypted || "",
    createdAt: user.createdAt || now,
  };

  for (const col of USERS_SHEET_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && userData[col] !== undefined) {
      rowData[index] = userData[col];
    }
  }

  console.log(`[Users Sheet] Appending user row for userId: ${user.userId}`);

  // Append row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, "A:Z"),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Users Sheet] Appended user row: ${user.userId}`);
}

/**
 * Update an existing user row in the Users sheet.
 */
async function updateUserRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  user: Partial<UserRow> & { userId: string; email: string }
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

  // Map user fields to columns (only update provided fields)
  const userData: Record<string, string> = {};
  if (user.userId !== undefined) userData.userId = user.userId;
  if (user.email !== undefined) userData.email = user.email;
  if (user.onboardingCompleted !== undefined) userData.onboardingCompleted = user.onboardingCompleted;
  if (user.sheetId !== undefined) userData.sheetId = user.sheetId;
  if (user.mainSpreadsheetId !== undefined) userData.mainSpreadsheetId = user.mainSpreadsheetId;
  if (user.driveFolderId !== undefined) userData.driveFolderId = user.driveFolderId;
  if (user.openaiKeyEncrypted !== undefined) userData.openaiKeyEncrypted = user.openaiKeyEncrypted;
  if (user.createdAt !== undefined) userData.createdAt = user.createdAt;

  for (const col of USERS_SHEET_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && userData[col] !== undefined) {
      rowData[index] = userData[col];
    }
  }

  console.log(`[Users Sheet] Updating user row ${rowIndex} for userId: ${user.userId}`);

  // Update row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Users Sheet] Updated user row: ${user.userId}`);
}

