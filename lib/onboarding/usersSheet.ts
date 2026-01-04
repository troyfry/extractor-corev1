/**
 * Users sheet helper for onboarding persistence.
 * 
 * Stores user onboarding data in a "Users" tab in Google Sheets.
 * This is the single source of truth for user onboarding status.
 */

import { createSheetsClient, formatSheetRange } from "@/lib/google/sheets";
import { getErrorMessage } from "@/lib/utils/error";
import { getColumnRange } from "@/lib/google/sheetsCache";

/**
 * Cache entry for Users sheet data.
 */
type CacheEntry = {
  headers: string[];
  rows: string[][];
  timestamp: number;
};

/**
 * Cache entry for Users sheet headers only.
 */
type HeadersCacheEntry = {
  headers: string[];
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
 * In-memory cache for Users sheet headers only.
 * Key: `${spreadsheetId}:Users:headers`
 * TTL: 5 minutes
 */
const headersCache = new Map<string, HeadersCacheEntry>();
const HEADERS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const errorCode = (error as { code?: number })?.code;
      const errorStatus = (error as { status?: number })?.status;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isQuotaError = errorCode === 429 || 
                          errorStatus === 429 ||
                          errorMessage.includes("quota") ||
                          errorMessage.includes("rate limit");
      
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
 * Extended to include workspace configuration (source of truth).
 */
const USERS_SHEET_COLUMNS = [
  "userId",
  "email",
  "onboardingCompleted",
  "sheetId",
  "mainSpreadsheetId", // The spreadsheet where this Users sheet is stored (legacy)
  "spreadsheetId", // Workspace spreadsheet ID (new, preferred)
  "driveFolderId", // Workspace drive folder ID (source of truth)
  "fmProfilesJson", // JSON string array of normalized fmKeys
  "templatesConfigured", // "TRUE" or "FALSE"
  "onboardingCompletedAt", // ISO timestamp
  "mainSheet", // Usually "Sheet1" or "Work_Orders" (legacy)
  "workOrdersSheet", // Usually "Work_Orders" (legacy)
  "templatesSheet", // Usually "Templates" (legacy)
  "signedFolderId", // Signed PDFs folder (legacy)
  "snippetsFolderId", // Snippets folder (legacy)
  "gmailWorkOrdersLabelName", // Gmail label name for work orders
  "gmailWorkOrdersLabelId", // Gmail label ID for work orders
  "gmailSignedLabelName", // Gmail label name for signed work orders
  "gmailSignedLabelId", // Gmail label ID for signed work orders
  "gmailProcessedLabelName", // Gmail label name for processed work orders (optional)
  "gmailProcessedLabelId", // Gmail label ID for processed work orders (optional)
  "openaiKeyEncrypted",
  "createdAt",
  "updatedAt",
] as const;

/**
 * User row type matching the Users sheet structure.
 * Extended to include workspace configuration.
 */
export type UserRow = {
  userId: string;
  email: string;
  onboardingCompleted: "TRUE" | "FALSE" | "";
  sheetId: string | ""; // Legacy
  mainSpreadsheetId: string | ""; // Legacy - The spreadsheet where this Users sheet is stored
  spreadsheetId: string | ""; // Workspace spreadsheet ID (new, preferred)
  driveFolderId: string | ""; // Workspace drive folder ID (source of truth)
  fmProfilesJson: string | ""; // JSON string array of normalized fmKeys
  templatesConfigured: "TRUE" | "FALSE" | ""; // Whether templates are configured
  onboardingCompletedAt: string | ""; // ISO timestamp
  mainSheet: string | ""; // Usually "Sheet1" or "Work_Orders" (legacy)
  workOrdersSheet: string | ""; // Usually "Work_Orders" (legacy)
  templatesSheet: string | ""; // Usually "Templates" (legacy)
  signedFolderId: string | ""; // Signed PDFs folder (legacy)
  snippetsFolderId: string | ""; // Snippets folder (legacy)
  gmailWorkOrdersLabelName: string | ""; // Gmail label name for work orders (legacy)
  gmailWorkOrdersLabelId: string | ""; // Gmail label ID for work orders (legacy)
  gmailSignedLabelName: string | ""; // Gmail label name for signed work orders (legacy)
  gmailSignedLabelId: string | ""; // Gmail label ID for signed work orders (legacy)
  gmailProcessedLabelName: string | ""; // Gmail label name for processed work orders (optional, legacy)
  gmailProcessedLabelId: string | ""; // Gmail label ID for processed work orders (optional, legacy)
  labelsJson: string | ""; // JSON string of WorkspaceLabels (new structure)
  openaiKeyEncrypted: string | "";
  createdAt: string | "";
  updatedAt: string | "";
};

/**
 * Get Users sheet data (headers + rows) with caching and deduplication.
 * 
 * SECURITY: This function reads the entire Users sheet (A2:Z) which is expensive.
 * It is restricted in production and may only be called from onboarding/admin routes.
 * 
 * For status checks and /pro routes, use getUserRowByIdNoEnsure() instead (column-only reads).
 */
async function getUsersSheetData(
  accessToken: string,
  spreadsheetId: string,
  options?: { allowFullRead?: boolean }
): Promise<{ headers: string[]; rows: string[][] }> {
  // Step 1: Production guard - check call stack to ensure only onboarding routes
  if (process.env.NODE_ENV === "production") {
    const stack = new Error().stack || "";
    const isOnboardingRoute =
      stack.includes("/api/onboarding/") ||
      stack.includes("/onboarding/") ||
      stack.includes("completeOnboarding");

    if (!isOnboardingRoute) {
      throw new Error(
        "getUsersSheetData() is restricted in production. Use getUserRowByIdNoEnsure() for status checks."
      );
    }
  }
  
  // Step 2: Hard guard - in production, require explicit allowFullRead flag
  if (process.env.NODE_ENV === "production" && !options?.allowFullRead) {
    throw new Error(
      "getUsersSheetData() full read is restricted in production. " +
      "Use getUserRowByIdNoEnsure() for status checks."
    );
  }
  
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
      // Determine last column based on expected columns (8 columns = A-H)
      const expectedColCount = USERS_SHEET_COLUMNS.length; // 8 columns
      const lastColLetter = colIndexToLetter(expectedColCount - 1); // H
      
      // Use batchGet to fetch header + data in one request (optimized range)
      incrementApiCallCount();
      const batchResponse = await retryWithBackoff(() =>
        sheets.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges: [
            formatSheetRange(sheetName, "1:1"), // Header row
            formatSheetRange(sheetName, `A2:${lastColLetter}`), // Data rows (only needed columns, skip header)
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
    } catch (error: unknown) {
      // If sheet doesn't exist or range is invalid, try optimized fallback
      const errorCode = (error as { code?: number })?.code;
      if (errorCode === 400) {
        try {
          // Fallback: read headers first, then data with only needed columns
          // Step 1: Read headers (Users!1:1)
          incrementApiCallCount();
          const headerResponse = await retryWithBackoff(() =>
            sheets.spreadsheets.values.get({
              spreadsheetId,
              range: formatSheetRange(sheetName, "1:1"),
            })
          );
          const headers = (headerResponse.data.values?.[0] || []) as string[];
          
          // Step 2: Determine last column based on actual headers or USERS_SHEET_COLUMNS
          // Use the larger of: actual header count or expected column count
          const expectedColCount = USERS_SHEET_COLUMNS.length;
          const actualColCount = headers.length;
          const colCount = Math.max(expectedColCount, actualColCount, 8); // At least 8 columns (A-H)
          
          // Convert column count to letter (e.g., 8 -> H, 15 -> O)
          const lastColLetter = colIndexToLetter(colCount - 1);
          
          // Step 3: Read data with optimized range (Users!A2:{lastCol})
          incrementApiCallCount();
          const dataResponse = await retryWithBackoff(() =>
            sheets.spreadsheets.values.get({
              spreadsheetId,
              range: formatSheetRange(sheetName, `A2:${lastColLetter}`),
            })
          );
          const rows = (dataResponse.data.values || []) as string[][];
          
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
 * 
 * SECURITY: This function may ONLY be called from onboarding routes:
 * - /api/onboarding/google
 * - /api/onboarding/openai
 * - /api/onboarding/fm-profiles
 * - /api/onboarding/templates/*
 * - /api/onboarding/complete (or /onboarding/done)
 * 
 * It must NEVER be called from:
 * - /pro routes
 * - /api/signed/process
 * - status helpers (getOnboardingStatus)
 * - server component render paths
 */
export async function ensureUsersSheet(
  accessToken: string,
  spreadsheetId: string,
  options?: { allowEnsure?: boolean }
): Promise<void> {
  // Hard guard: in production, require explicit allowEnsure flag
  if (process.env.NODE_ENV === "production" && !options?.allowEnsure) {
    console.error("[Users Sheet] BLOCKED: ensureUsersSheet() called without allowEnsure in production");
    throw new Error(
      "ensureUsersSheet() is restricted in production. " +
      "Call ensureUsersSheet(accessToken, spreadsheetId, { allowEnsure: true }) only from onboarding setup routes."
    );
  }
  
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
  } catch (error: unknown) {
    console.error(`[Users Sheet] Error ensuring Users sheet:`, error);
    
    // Provide more helpful error messages
    const errorCode = (error as { code?: number })?.code;
    const errorStatus = (error as { status?: number })?.status;
    if (errorCode === 404 || errorStatus === 404) {
      throw new Error(
        `Spreadsheet not found (ID: ${spreadsheetId}). ` +
        `Please verify the spreadsheet ID is correct and the spreadsheet exists.`
      );
    }
    
    if (errorCode === 403 || errorStatus === 403) {
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
      `Failed to access spreadsheet: ${getErrorMessage(error) || "Unknown error"}. ` +
      `Please verify the spreadsheet ID and your access permissions.`
    );
  }
}

/**
 * Get Users sheet headers with caching (TTL 5 min).
 * Reads only Users!1:1.
 */
async function getUsersHeadersCached(
  accessToken: string,
  spreadsheetId: string
): Promise<string[]> {
  const cacheKey = `${spreadsheetId}:Users:headers`;
  const cached = sheetCache.get(cacheKey);
  
  // Headers cache TTL: 5 minutes (longer than full sheet cache since headers change rarely)
  if (cached?.headers && Date.now() - cached.timestamp < HEADERS_CACHE_TTL_MS) {
    return cached.headers;
  }

  const sheets = createSheetsClient(accessToken);
  incrementApiCallCount();
  const res = await retryWithBackoff(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange("Users", "1:1"),
    })
  );

  const headers = (res.data.values?.[0] || []) as string[];
  sheetCache.set(cacheKey, { headers, rows: [], timestamp: Date.now() });
  return headers;
}

/**
 * Convert column index to letter (A, B, C, ..., Z, AA, AB, ...).
 */
function colIndexToLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Find user row index by reading ONLY the userId column.
 * Reads only Users!{userIdColLetter}:{userIdColLetter}.
 */
async function findRowIndexByUserId(
  accessToken: string,
  spreadsheetId: string,
  userId: string,
  userIdColLetter: string
): Promise<number> {
  const sheets = createSheetsClient(accessToken);
  incrementApiCallCount();
  const res = await retryWithBackoff(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `Users!${userIdColLetter}:${userIdColLetter}`,
    })
  );

  const col = res.data.values || [];
  const normalizedUserId = userId.trim();
  
  for (let i = 0; i < col.length; i++) {
    const cell = (col[i]?.[0] || "").trim();
    if (cell === normalizedUserId) {
      return i + 1; // 1-based row index
    }
  }
  return -1;
}

/**
 * Read ONE row only.
 * Reads only Users!{rowIndex}:{rowIndex}.
 */
async function readRowByIndex(
  accessToken: string,
  spreadsheetId: string,
  rowIndex: number
): Promise<string[]> {
  const sheets = createSheetsClient(accessToken);
  incrementApiCallCount();
  const res = await retryWithBackoff(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange("Users", `${rowIndex}:${rowIndex}`),
    })
  );
  return (res.data.values?.[0] || []) as string[];
}

/**
 * Get a user row by userId from the Users sheet (NO ensure, NO full reads).
 * Uses cached data when possible.
 * 
 * This is the safe version that NEVER calls ensureUsersSheet or getUsersSheetData().
 * Use this for status checks, /pro routes, and any non-onboarding paths.
 * 
 * Optimized "column-only + row-only" flow:
 * 1. Check userRowCache first (TTL: 60 seconds) - 0 reads if cache hit
 * 2. Headers = getUsersHeadersCached(Users!1:1) - 1 read, cached 5 minutes
 * 3. Find userId column index
 * 4. Read only that column: Users!{UserIdCol}:{UserIdCol} - 1 read
 * 5. Locate the row index
 * 6. Read one row: Users!{rowIndex}:{rowIndex} - 1 read
 * 7. Map row → UserRow
 * 8. Cache userRowCache
 * 
 * Total: Max 3 reads (1 header + 1 column + 1 row)
 * On repeated /pro refreshes: 0 reads if userRowCache TTL hits
 * 
 * NOTE: Does NOT call ensureUsersSheet or getUsersSheetData().
 */
export async function getUserRowByIdNoEnsure(
  accessToken: string,
  spreadsheetId: string,
  userId: string
): Promise<UserRow | null> {
  const cacheKey = `${spreadsheetId}:${userId}`;
  
  // Check userRowCache first (0 reads if cache hit)
  const cached = userRowCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[Users Sheet] Cache hit for user ${userId} - 0 API reads`);
    return cached.value;
  }

  try {
    // Step 1: Headers = getUsersHeadersCached(Users!1:1) - 1 read, cached 5 minutes
    const headers = await getUsersHeadersCached(accessToken, spreadsheetId);
    
    if (headers.length === 0) {
      userRowCache.set(cacheKey, {
        value: null,
        expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
      });
      return null;
    }

    const headersLower = headers.map((h) => h.toLowerCase().trim());

    // Step 2: Find userId column index
    const userIdColIndex = headersLower.indexOf("userid");
    if (userIdColIndex === -1) {
      userRowCache.set(cacheKey, {
        value: null,
        expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
      });
      return null;
    }

    // Step 3: Convert index to column letter (A, B, C...)
    const userIdColLetter = colIndexToLetter(userIdColIndex);

    // Step 4: Read only that column: Users!{UserIdCol}:{UserIdCol} - 1 read
    const rowIndex = await findRowIndexByUserId(
      accessToken,
      spreadsheetId,
      userId,
      userIdColLetter
    );

    // Step 5: If not found, cache null
    if (rowIndex === -1) {
      userRowCache.set(cacheKey, {
        value: null,
        expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
      });
      return null;
    }

    // Step 6: Read one row: Users!{rowIndex}:{rowIndex} - 1 read
    const row = await readRowByIndex(accessToken, spreadsheetId, rowIndex);

    // Step 7: Map row → UserRow
    const userRow: Partial<UserRow> = {};
    for (const col of USERS_SHEET_COLUMNS) {
      const colIndex = headersLower.indexOf(col.toLowerCase());
      if (colIndex !== -1 && row[colIndex] !== undefined) {
        const value = row[colIndex];
        (userRow as Record<string, string>)[col] = value === "" ? "" : value;
      } else {
        (userRow as Record<string, string>)[col] = "";
      }
    }
    const result = userRow as UserRow;
    
    // Step 8: Cache userRowCache (TTL: 60 seconds)
    // On repeated /pro refreshes, this becomes 0 reads if cache TTL hits
    userRowCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + USER_ROW_CACHE_TTL_MS,
    });
    console.log(`[Users Sheet] Fetched and cached user row for ${userId} (column-only read: 1 header + 1 column + 1 row = 3 reads total)`);
    return result;
  } catch (error) {
    console.error(`[Users Sheet] Error getting user row:`, error);
    throw error;
  }
}

/**
 * Get a user row by userId from the Users sheet.
 * Uses cached data when possible.
 * 
 * NOTE: This function may call ensureUsersSheet in some contexts.
 * For status checks and /pro routes, use getUserRowByIdNoEnsure() instead.
 * 
 * @deprecated For status checks, use getUserRowByIdNoEnsure() instead.
 */
export async function getUserRowById(
  accessToken: string,
  spreadsheetId: string,
  userId: string
): Promise<UserRow | null> {
  // Delegate to no-ensure version (getUserRowById never called ensure anyway)
  return getUserRowByIdNoEnsure(accessToken, spreadsheetId, userId);
}

/**
 * Upsert a user row in the Users sheet.
 * If userId exists, updates the row; otherwise appends a new row.
 * Uses cached data when possible.
 * 
 * @param options.allowEnsure - If true, allows ensureUsersSheet to run (onboarding routes only)
 */
export async function upsertUserRow(
  accessToken: string,
  spreadsheetId: string,
  user: Partial<UserRow> & { userId: string; email: string },
  options?: { allowEnsure?: boolean }
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Users";

  // Ensure sheet exists (only if explicitly allowed, typically in onboarding routes)
  if (options?.allowEnsure) {
    await ensureUsersSheet(accessToken, spreadsheetId, { allowEnsure: true });
  }

  try {
    // Get data from cache or fetch (onboarding route - allow full read)
    const { headers, rows } = await getUsersSheetData(accessToken, spreadsheetId, { allowFullRead: true });
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
 * Set onboardingCompleted to "TRUE" for a user and update workspace fields.
 */
export async function setOnboardingCompleted(
  accessToken: string,
  spreadsheetId: string,
  userId: string
): Promise<void> {
  const userRow = await getUserRowByIdNoEnsure(accessToken, spreadsheetId, userId);
  if (!userRow) {
    throw new Error(`User ${userId} not found in Users sheet`);
  }

  const now = new Date().toISOString();
  await upsertUserRow(accessToken, spreadsheetId, {
    ...userRow,
    // Ensure workspace fields are set
    spreadsheetId: userRow.spreadsheetId || spreadsheetId,
    mainSheet: userRow.mainSheet || "Sheet1",
    workOrdersSheet: userRow.workOrdersSheet || "Work_Orders",
    templatesSheet: userRow.templatesSheet || "Templates",
    signedFolderId: userRow.signedFolderId || userRow.driveFolderId || "",
    snippetsFolderId: userRow.snippetsFolderId || userRow.driveFolderId || "",
    updatedAt: now,
    onboardingCompleted: "TRUE",
  }, { allowEnsure: true }); // Allow ensure in onboarding completion
  
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
    spreadsheetId: user.spreadsheetId || "",
    driveFolderId: user.driveFolderId || "",
    fmProfilesJson: user.fmProfilesJson || "",
    templatesConfigured: user.templatesConfigured || "",
    onboardingCompletedAt: user.onboardingCompletedAt || "",
    mainSheet: user.mainSheet || "",
    workOrdersSheet: user.workOrdersSheet || "",
    templatesSheet: user.templatesSheet || "",
    signedFolderId: user.signedFolderId || "",
    snippetsFolderId: user.snippetsFolderId || "",
    openaiKeyEncrypted: user.openaiKeyEncrypted || "",
    createdAt: user.createdAt || now,
    updatedAt: user.updatedAt || now,
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
      range: formatSheetRange(sheetName, getColumnRange(USERS_SHEET_COLUMNS.length)),
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
  if (user.spreadsheetId !== undefined) userData.spreadsheetId = user.spreadsheetId;
  if (user.driveFolderId !== undefined) userData.driveFolderId = user.driveFolderId;
  if (user.fmProfilesJson !== undefined) userData.fmProfilesJson = user.fmProfilesJson;
  if (user.templatesConfigured !== undefined) userData.templatesConfigured = user.templatesConfigured;
  if (user.onboardingCompletedAt !== undefined) userData.onboardingCompletedAt = user.onboardingCompletedAt;
  if (user.mainSheet !== undefined) userData.mainSheet = user.mainSheet;
  if (user.workOrdersSheet !== undefined) userData.workOrdersSheet = user.workOrdersSheet;
  if (user.templatesSheet !== undefined) userData.templatesSheet = user.templatesSheet;
  if (user.signedFolderId !== undefined) userData.signedFolderId = user.signedFolderId;
  if (user.snippetsFolderId !== undefined) userData.snippetsFolderId = user.snippetsFolderId;
  if (user.openaiKeyEncrypted !== undefined) userData.openaiKeyEncrypted = user.openaiKeyEncrypted;
  if (user.createdAt !== undefined) userData.createdAt = user.createdAt;
  // Always update updatedAt if any field is being updated
  if (Object.keys(userData).length > 0 && !userData.updatedAt) {
    userData.updatedAt = new Date().toISOString();
  }

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

