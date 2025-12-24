/**
 * Users sheet helper for onboarding persistence.
 * 
 * Stores user onboarding data in a "Users" tab in Google Sheets.
 * This is the single source of truth for user onboarding status.
 */

import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";

/**
 * Cache entry for Users sheet data.
 */
type CacheEntry = {
  headers: string[];
  rows: string[][];
  timestamp: number;
};

/**
 * Cache entry for individual user rows.
 */
type UserRowCacheEntry = {
  value: UserRow | null;
  expiresAt: number;
};

/**
 * In-memory cache for Users sheet reads.
 * Key: `${spreadsheetId}:Users`
 * TTL: 15 seconds
 */
const sheetCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 1000; // 15 seconds

/**
 * In-memory cache for individual user rows.
 * Key: `${spreadsheetId}:${userId}`
 * TTL: 60 seconds
 */
const userRowCache = new Map<string, UserRowCacheEntry>();
const USER_ROW_CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * In-flight promise deduplication - prevents concurrent reads of the same sheet.
 */
const inFlightPromises = new Map<string, Promise<{ headers: string[]; rows: string[][] }>>();

/**
 * Track API call counts for logging.
 */
let apiCallCount = 0;

/**
 * Reset API call counter (called at start of each route).
 */
export function resetApiCallCount(): void {
  apiCallCount = 0;
}

/**
 * Get current API call count.
 */
export function getApiCallCount(): number {
  return apiCallCount;
}

/**
 * Increment API call count.
 */
function incrementApiCallCount(): void {
  apiCallCount++;
}

/**
 * Retry helper with exponential backoff for 429/quota errors.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isQuotaError = error?.code === 429 || 
                          error?.status === 429 ||
                          error?.message?.includes("quota") ||
                          error?.message?.includes("rate limit");
      
      if (isQuotaError && attempt < maxRetries) {
        const delayMs = attempt === 0 ? 250 : 750; // 250ms, then 750ms
        console.warn(`[Users Sheet] Quota error, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

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
 * Get Users sheet data (headers + rows) with caching and deduplication.
 */
async function getUsersSheetData(
  accessToken: string,
  spreadsheetId: string
): Promise<{ headers: string[]; rows: string[][] }> {
  const cacheKey = `${spreadsheetId}:Users`;
  
  // Check cache
  const cached = sheetCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { headers: cached.headers, rows: cached.rows };
  }

  // Check if there's an in-flight request
  const inFlight = inFlightPromises.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  // Create new fetch promise
  const fetchPromise = (async () => {
    const sheets = createSheetsClient(accessToken);
    const sheetName = "Users";

    try {
      // Use batchGet to fetch header + data in one request
      incrementApiCallCount();
      const batchResponse = await retryWithBackoff(() =>
        sheets.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges: [
            formatSheetRange(sheetName, "1:1"), // Header row
            formatSheetRange(sheetName, "A2:Z"), // Data rows (skip header)
          ],
        })
      );

      const headerRange = batchResponse.data.valueRanges?.[0];
      const dataRange = batchResponse.data.valueRanges?.[1];

      const headers = (headerRange?.values?.[0] || []) as string[];
      const rows = (dataRange?.values || []) as string[][];

      // Update cache
      sheetCache.set(cacheKey, {
        headers,
        rows,
        timestamp: Date.now(),
      });

      return { headers, rows };
    } catch (error: any) {
      // If sheet doesn't exist or range is invalid, try single read
      if (error?.code === 400) {
        try {
          // Fallback: read all data in one request
          incrementApiCallCount();
          const allDataResponse = await retryWithBackoff(() =>
            sheets.spreadsheets.values.get({
              spreadsheetId,
              range: formatSheetRange(sheetName, "A:Z"),
            })
          );
          const allRows = allDataResponse.data.values || [];
          const headers = (allRows[0] || []) as string[];
          const rows = allRows.slice(1) as string[][];
          
          sheetCache.set(cacheKey, {
            headers,
            rows,
            timestamp: Date.now(),
          });
          
          return { headers, rows };
        } catch (fallbackError) {
          // If still fails, return empty
          return { headers: [], rows: [] };
        }
      }
      throw error;
    } finally {
      // Remove from in-flight
      inFlightPromises.delete(cacheKey);
    }
  })();

  // Store in-flight promise
  inFlightPromises.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Ensure the "Users" tab exists with required headers.
 * Idempotent and low-read: only reads header, doesn't re-read after writing.
 */
export async function ensureUsersSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Users";

  try {
    // Get spreadsheet metadata to check if sheet exists
    incrementApiCallCount();
    const spreadsheetResponse = await retryWithBackoff(() =>
      sheets.spreadsheets.get({
        spreadsheetId,
      })
    );

    const sheetExists = spreadsheetResponse.data.sheets?.some(
      (sheet) => sheet.properties?.title === sheetName
    );

    // Create sheet if it doesn't exist
    if (!sheetExists) {
      console.log(`[Users Sheet] Creating "${sheetName}" sheet`);
      incrementApiCallCount();
      await retryWithBackoff(() =>
        sheets.spreadsheets.batchUpdate({
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
        })
      );
      console.log(`[Users Sheet] Created "${sheetName}" sheet`);
      // Invalidate cache
      sheetCache.delete(`${spreadsheetId}:Users`);
    }

    // Get current header row only (don't read data)
    incrementApiCallCount();
    const headerResponse = await retryWithBackoff(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: formatSheetRange(sheetName, "1:1"),
      })
    );

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
      // Update cache with headers if we have them
      const cacheKey = `${spreadsheetId}:Users`;
      const cached = sheetCache.get(cacheKey);
      if (cached) {
        cached.headers = existingHeaders;
        cached.timestamp = Date.now();
      }
      return;
    }

    // Add missing columns to the header row
    const updatedHeaders = [...existingHeaders, ...missingColumns];

    // Update the header row
    incrementApiCallCount();
    await retryWithBackoff(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: formatSheetRange(sheetName, "1:1"),
        valueInputOption: "RAW",
        requestBody: {
          values: [updatedHeaders],
        },
      })
    );

    // Invalidate cache since headers changed
    sheetCache.delete(`${spreadsheetId}:Users`);
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
 * Uses cached data when possible.
 * 
 * NOTE: Does NOT call ensureUsersSheet automatically. Call ensureUsersSheet separately
 * in onboarding routes if needed.
 */
export async function getUserRowById(
  accessToken: string,
  spreadsheetId: string,
  userId: string
): Promise<UserRow | null> {
  const cacheKey = `${spreadsheetId}:${userId}`;
  
  // Check per-user cache first
  const cached = userRowCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[Users Sheet] Cache hit for user ${userId}`);
    return cached.value;
  }

  try {
    // Get data from cache or fetch (this uses sheet-level cache)
    const { headers, rows } = await getUsersSheetData(accessToken, spreadsheetId);
    
    if (rows.length === 0 || headers.length === 0) {
      // Cache null result
      userRowCache.set(cacheKey, {
        value: null,
        expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
      });
      return null;
    }

    const headersLower = headers.map((h) => h.toLowerCase().trim());

    // Find userId column index
    const userIdColIndex = headersLower.indexOf("userid");
    if (userIdColIndex === -1) {
      // Cache null result
      userRowCache.set(cacheKey, {
        value: null,
        expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
      });
      return null;
    }

    // Find row with matching userId
    for (const row of rows) {
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
        const result = userRow as UserRow;
        
        // Cache the result
        userRowCache.set(cacheKey, {
          value: result,
          expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
        });
        console.log(`[Users Sheet] Fetched and cached user row for ${userId}`);
        return result;
      }
    }

    // User not found, cache null result
    userRowCache.set(cacheKey, {
      value: null,
      expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
    });
    return null;
  } catch (error) {
    console.error(`[Users Sheet] Error getting user row:`, error);
    throw error;
  }
}

/**
 * Upsert a user row in the Users sheet.
 * If userId exists, updates the row; otherwise appends a new row.
 * Uses cached data when possible.
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
    // Get data from cache or fetch
    const { headers, rows } = await getUsersSheetData(accessToken, spreadsheetId);
    const headersLower = headers.map((h) => h.toLowerCase().trim());

    // Find userId column index
    const userIdColIndex = headersLower.indexOf("userid");
    if (userIdColIndex === -1) {
      // No userId column yet, just append
      await appendUserRow(sheets, spreadsheetId, sheetName, user);
      // Invalidate cache
      sheetCache.delete(`${spreadsheetId}:Users`);
      return;
    }

    // Find existing row by userId
    let existingRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[userIdColIndex] === user.userId) {
        existingRowIndex = i + 2; // +2 because Sheets is 1-indexed and we skip header row
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
    
    // Invalidate caches
    sheetCache.delete(`${spreadsheetId}:Users`);
    userRowCache.delete(`${spreadsheetId}:${user.userId}`);
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
  
  // Invalidate user row cache (upsertUserRow already does this, but be explicit)
  userRowCache.delete(`${spreadsheetId}:${userId}`);
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
  // Get headers from cache if available, otherwise fetch
  const cacheKey = `${spreadsheetId}:Users`;
  const cached = sheetCache.get(cacheKey);
  let headers: string[];
  
  if (cached && cached.headers.length > 0) {
    headers = cached.headers;
  } else {
    incrementApiCallCount();
    const headerResponse = await retryWithBackoff(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: formatSheetRange(sheetName, "1:1"),
      })
    );
    headers = (headerResponse.data.values?.[0] || []) as string[];
  }
  
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
  incrementApiCallCount();
  await retryWithBackoff(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: formatSheetRange(sheetName, "A:Z"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [rowData],
      },
    })
  );

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
  // Get headers from cache if available
  const cacheKey = `${spreadsheetId}:Users`;
  const cached = sheetCache.get(cacheKey);
  let headers: string[];
  
  if (cached && cached.headers.length > 0) {
    headers = cached.headers;
  } else {
    incrementApiCallCount();
    const headerResponse = await retryWithBackoff(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: formatSheetRange(sheetName, "1:1"),
      })
    );
    headers = (headerResponse.data.values?.[0] || []) as string[];
  }
  
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  // Get existing row to preserve values
  incrementApiCallCount();
  const existingRowResponse = await retryWithBackoff(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    })
  );

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
  incrementApiCallCount();
  await retryWithBackoff(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
      valueInputOption: "RAW",
      requestBody: {
        values: [rowData],
      },
    })
  );

  console.log(`[Users Sheet] Updated user row: ${user.userId}`);
}

