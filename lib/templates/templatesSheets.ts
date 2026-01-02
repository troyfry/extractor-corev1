/**
 * Template crop zone persistence in Google Sheets.
 * 
 * Stores template crop zones in "Templates" tab of the user's Google Sheet.
 * Each row represents a crop zone for a specific fmKey.
 */

import { createSheetsClient } from "@/lib/google/sheets";
import { getErrorMessage } from "@/lib/utils/error";
import { normalizeFmKey } from "@/lib/templates/fmProfiles";
import { getColumnRange } from "@/lib/google/sheetsCache";

/**
 * Required columns for Template storage in Google Sheets.
 */
const TEMPLATE_COLUMNS = [
  "userId",
  "fmKey",
  "templateId",
  "page",
  "xPct",
  "yPct",
  "wPct",
  "hPct",
  "dpi",
  "coordSystem",
  "pageWidthPt",
  "pageHeightPt",
  "xPt",
  "yPt",
  "wPt",
  "hPt",
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
 * Template crop zone data structure.
 */
export type Template = {
  userId: string;
  fmKey: string;
  templateId: string;
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  dpi?: number;
  // New PDF points fields (optional for backward compatibility)
  coordSystem?: string;
  pageWidthPt?: number;
  pageHeightPt?: number;
  xPt?: number;
  yPt?: number;
  wPt?: number;
  hPt?: number;
  updated_at: string;
};

/**
 * Ensure the "Templates" tab exists with required headers.
 */
export async function ensureTemplatesSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Templates";

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
      console.log(`[Templates] Creating "${sheetName}" sheet`);
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
        console.log(`[Templates] Created "${sheetName}" sheet`);
      } catch (error) {
        // Handle race condition: sheet might have been created by another concurrent request
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("already exists") || errorMessage.includes("duplicate")) {
          console.log(`[Templates] Sheet "${sheetName}" already exists (likely created concurrently), continuing...`);
        } else {
          throw error;
        }
      }
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
    for (const col of TEMPLATE_COLUMNS) {
      if (!existingHeadersLower.includes(col.toLowerCase())) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length === 0) {
      console.log(`[Templates] "${sheetName}" sheet is ready`);
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

    console.log(`[Templates] Added ${missingColumns.length} missing columns to "${sheetName}" sheet`);
  } catch (error) {
    console.error(`[Templates] Error ensuring Templates sheet:`, error);
    throw error;
  }
}

/**
 * Get all templates for a user from Google Sheets.
 */
/**
 * List all templates for a spreadsheet (shared across users).
 * Templates are scoped to spreadsheetId + fmKey, not userId.
 */
export async function listTemplatesForUser(
  accessToken: string,
  spreadsheetId: string,
  userId: string // Kept for backward compatibility but not used for filtering
): Promise<Template[]> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Templates";

  try {
    // Ensure sheet exists
    await ensureTemplatesSheet(spreadsheetId, accessToken);

    // Get all data
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(TEMPLATE_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0 || rows.length === 1) {
      // Only headers or empty - no templates
      console.log(`[Templates] No templates found in "${sheetName}" sheet`);
      return [];
    }

    const headers = rows[0] as string[];
    const templates: Template[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Skip empty rows
      if (!row || row.every(cell => !cell || String(cell).trim() === "")) {
        continue;
      }
      const template = parseTemplateFromRow(row, headers);
      // Templates are shared per spreadsheet - no userId filtering
      if (template) {
        templates.push(template);
      }
    }

    console.log(`[Templates] Loaded ${templates.length} template(s) for spreadsheet: ${spreadsheetId.substring(0, 10)}...`);
    return templates;
  } catch (error: unknown) {
    console.error(`[Templates] Error getting templates:`, error);
    
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
 * Get template by fmKey for a user.
 */
/**
 * Helper function to get rowData for logging (used in save route).
 * This simulates what will be written to Sheets without actually writing.
 */
export async function getTemplateRowDataForLogging(
  accessToken: string,
  spreadsheetId: string,
  template: {
    userId: string;
    fmKey: string;
    templateId: string;
    page: number;
    xPct: string | number;
    yPct: string | number;
    wPct: string | number;
    hPct: string | number;
    dpi?: number;
    coordSystem: string;
    pageWidthPt: number;
    pageHeightPt: number;
    xPt: number;
    yPt: number;
    wPt: number;
    hPt: number;
    updated_at?: string;
  }
): Promise<{ rowData: string[]; columnMapping: Record<string, { index: number; value: string }> }> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Templates";
  
  // Get headers to determine column order
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: formatSheetRange(sheetName, "1:1"),
  });

  const headers = (headerResponse.data.values?.[0] || []) as string[];
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  // Build row data in the correct column order
  const rowData: string[] = new Array(headers.length).fill("");

  // Map template fields to columns
  // POINTS-ONLY: xPct/yPct/wPct/hPct may be empty strings
  const templateData: Record<string, string> = {
    userId: template.userId,
    fmKey: template.fmKey,
    templateId: template.templateId,
    page: String(template.page),
    xPct: template.xPct === "" ? "" : String(template.xPct),
    yPct: template.yPct === "" ? "" : String(template.yPct),
    wPct: template.wPct === "" ? "" : String(template.wPct),
    hPct: template.hPct === "" ? "" : String(template.hPct),
    dpi: template.dpi !== undefined ? String(template.dpi) : "",
    coordSystem: template.coordSystem || "",
    pageWidthPt: template.pageWidthPt !== undefined ? String(template.pageWidthPt) : "",
    pageHeightPt: template.pageHeightPt !== undefined ? String(template.pageHeightPt) : "",
    xPt: template.xPt !== undefined ? String(template.xPt) : "",
    yPt: template.yPt !== undefined ? String(template.yPt) : "",
    wPt: template.wPt !== undefined ? String(template.wPt) : "",
    hPt: template.hPt !== undefined ? String(template.hPt) : "",
    updated_at: template.updated_at || new Date().toISOString(),
  };

  const columnMapping: Record<string, { index: number; value: string }> = {};

  for (const col of TEMPLATE_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && templateData[col] !== undefined) {
      rowData[index] = templateData[col];
      columnMapping[col] = { index, value: templateData[col] };
    }
  }

  return { rowData, columnMapping };
}

/**
 * Get template by fmKey for a spreadsheet (shared across users).
 * Templates are scoped to spreadsheetId + fmKey, not userId.
 */
export async function getTemplateByFmKey(
  accessToken: string,
  spreadsheetId: string,
  userId: string, // Kept for backward compatibility but not used for filtering
  fmKey: string
): Promise<Template | null> {
  const templates = await listTemplatesForUser(accessToken, spreadsheetId, userId);
  // Use normalizeFmKey for consistent normalization (handles spaces, special chars, etc.)
  const normalizedFmKey = normalizeFmKey(fmKey);
  const found = templates.find(t => {
    const templateNormalized = normalizeFmKey(t.fmKey);
    // Guardrail: fmKey normalized mismatch
    if (templateNormalized !== normalizedFmKey && normalizeFmKey(t.fmKey) !== normalizeFmKey(normalizedFmKey)) {
      console.warn("[Templates] Guardrail: fmKey normalized mismatch", {
        requestedFmKey: fmKey,
        requestedNormalized: normalizedFmKey,
        templateFmKey: t.fmKey,
        templateNormalized,
      });
    }
    return templateNormalized === normalizedFmKey;
  }) || null;
  
  if (!found) {
    console.log(`[Templates] getTemplateByFmKey: Template not found`, {
      searchedFmKey: normalizedFmKey,
      originalFmKey: fmKey,
      spreadsheetId: spreadsheetId.substring(0, 10) + "...",
      foundTemplates: templates.length,
      availableFmKeys: templates.map(t => ({ original: t.fmKey, normalized: normalizeFmKey(t.fmKey) })),
    });
  }
  
  return found;
}

/**
 * Convert a template input to a Template type, ensuring percentage values are numbers.
 */
function convertToTemplate(
  template: {
    userId: string;
    fmKey: string;
    templateId?: string;
    page: number;
    xPct: string | number;
    yPct: string | number;
    wPct: string | number;
    hPct: string | number;
    dpi?: number;
    coordSystem?: string;
    pageWidthPt?: number;
    pageHeightPt?: number;
    xPt?: number;
    yPt?: number;
    wPt?: number;
    hPt?: number;
  },
  normalizedFmKey: string,
  templateId: string,
  updated_at: string
): Template {
  const toNumber = (val: string | number): number => {
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const trimmed = val.trim();
      return trimmed !== "" ? parseFloat(trimmed) || 0 : 0;
    }
    return 0;
  };

  return {
    userId: template.userId,
    fmKey: normalizedFmKey,
    templateId,
    page: template.page,
    xPct: toNumber(template.xPct),
    yPct: toNumber(template.yPct),
    wPct: toNumber(template.wPct),
    hPct: toNumber(template.hPct),
    dpi: template.dpi,
    coordSystem: template.coordSystem,
    pageWidthPt: template.pageWidthPt,
    pageHeightPt: template.pageHeightPt,
    xPt: template.xPt,
    yPt: template.yPt,
    wPt: template.wPt,
    hPt: template.hPt,
    updated_at,
  };
}

/**
 * Upsert a template (insert or update).
 * Templates are shared per spreadsheet - one row per (spreadsheetId + fmKey).
 * userId is stored for audit purposes but not used for uniqueness.
 */
export async function upsertTemplate(
  accessToken: string,
  spreadsheetId: string,
  template: {
    userId: string; // Stored for audit but not used for uniqueness
    fmKey: string;
    templateId?: string; // Optional, defaults to fmKey
    page: number;
    xPct: string | number; // POINTS-ONLY: can be "" (empty string) to avoid fallback
    yPct: string | number;
    wPct: string | number;
    hPct: string | number;
    dpi?: number;
    // New PDF points fields (optional)
    coordSystem?: string;
    pageWidthPt?: number;
    pageHeightPt?: number;
    xPt?: number;
    yPt?: number;
    wPt?: number;
    hPt?: number;
  }
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Templates";

  // Ensure sheet exists with headers
  await ensureTemplatesSheet(spreadsheetId, accessToken);

  const templateId = template.templateId || template.fmKey;
  // Use normalizeFmKey for consistent normalization (handles spaces, special chars, etc.)
  const normalizedFmKey = normalizeFmKey(template.fmKey);

  try {
    // Get all data to find existing row by userId + fmKey
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(TEMPLATE_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      // No data, just append
      // Always save normalized fmKey to ensure consistency
      await appendTemplateRow(
        sheets,
        spreadsheetId,
        sheetName,
        convertToTemplate(template, normalizedFmKey, templateId, new Date().toISOString())
      );
      return;
    }

    // Find row index by fmKey only (templates are shared per spreadsheet)
    const headers = rows[0] as string[];
    const userIdColIndex = headers.findIndex(
      (h) => h.toLowerCase().trim() === "userid"
    );
    const fmKeyColIndex = headers.findIndex(
      (h) => h.toLowerCase().trim() === "fmkey"
    );
    const templateIdColIndex = headers.findIndex(
      (h) => h.toLowerCase().trim() === "templateid"
    );

    if (fmKeyColIndex === -1) {
      // Required column not found, just append
      // Always save normalized fmKey to ensure consistency
      await appendTemplateRow(
        sheets,
        spreadsheetId,
        sheetName,
        convertToTemplate(template, normalizedFmKey, templateId, new Date().toISOString())
      );
      return;
    }

    // Find existing row by fmKey only (templates are shared per spreadsheet, not per user)
    // Use normalizeFmKey for consistent comparison
    let existingRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowFmKeyRaw = (row?.[fmKeyColIndex] || "").trim();
      const rowFmKeyNormalized = normalizeFmKey(rowFmKeyRaw);
      if (rowFmKeyNormalized === normalizedFmKey) {
        existingRowIndex = i + 1; // +1 because Sheets is 1-indexed
        break;
      }
    }

    // Check for duplicate templateId (if templateId column exists)
    // TemplateId should be unique per spreadsheet
    if (templateIdColIndex !== -1) {
      const normalizedTemplateId = templateId.toLowerCase().trim();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowTemplateId = (row?.[templateIdColIndex] || "").trim().toLowerCase();
        const rowFmKeyRaw = (row?.[fmKeyColIndex] || "").trim();
        const rowFmKeyNormalized = normalizeFmKey(rowFmKeyRaw);
        
        // Check if templateId already exists
        if (rowTemplateId === normalizedTemplateId) {
          // If it's the same row we're updating (by fmKey), that's OK
          if (existingRowIndex !== -1 && i + 1 === existingRowIndex) {
            continue; // Same row, allow update
          }
          // Otherwise, it's a duplicate templateId for a different fmKey
          throw new Error(
            `Template ID "${templateId}" already exists (FM Key: ${rowFmKeyNormalized}). Each template ID must be unique per spreadsheet.`
          );
        }
      }
    }

    if (existingRowIndex === -1) {
      // Row doesn't exist, append it
      // Always save normalized fmKey to ensure consistency
      await appendTemplateRow(
        sheets,
        spreadsheetId,
        sheetName,
        convertToTemplate(template, normalizedFmKey, templateId, new Date().toISOString())
      );
    } else {
      // Row exists, update it
      // Always save normalized fmKey to ensure consistency
      await updateTemplateRow(
        sheets,
        spreadsheetId,
        sheetName,
        existingRowIndex,
        convertToTemplate(template, normalizedFmKey, templateId, new Date().toISOString())
      );
    }
  } catch (error) {
    console.error(`[Templates] Error upserting template:`, error);
    throw error;
  }
}

/**
 * Append a new template row to Google Sheets.
 */
async function appendTemplateRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  template: Template
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

  // Map template fields to columns
  // Each template is independent - write only what's appropriate for its coordSystem
  const templateData: Record<string, string> = {
    userId: template.userId,
    fmKey: template.fmKey,
    templateId: template.templateId,
    page: String(template.page),
    dpi: template.dpi !== undefined ? String(template.dpi) : "",
    coordSystem: template.coordSystem || "",
    updated_at: template.updated_at,
  };

  // PDF_POINTS templates: points are source of truth, percentages set to empty
  if (template.coordSystem === "PDF_POINTS" || template.coordSystem === "PDF_POINTS_TOP_LEFT") {
    templateData.pageWidthPt = template.pageWidthPt !== undefined ? String(template.pageWidthPt) : "";
    templateData.pageHeightPt = template.pageHeightPt !== undefined ? String(template.pageHeightPt) : "";
    templateData.xPt = template.xPt !== undefined ? String(template.xPt) : "";
    templateData.yPt = template.yPt !== undefined ? String(template.yPt) : "";
    templateData.wPt = template.wPt !== undefined ? String(template.wPt) : "";
    templateData.hPt = template.hPt !== undefined ? String(template.hPt) : "";
    // Set percentages to empty to avoid accidental fallback
    templateData.xPct = "";
    templateData.yPct = "";
    templateData.wPct = "";
    templateData.hPct = "";
  } else {
    // Legacy templates: write percentages (and points if available)
    templateData.xPct = String(template.xPct);
    templateData.yPct = String(template.yPct);
    templateData.wPct = String(template.wPct);
    templateData.hPct = String(template.hPct);
    // Include points if available (for future migration)
    if (template.pageWidthPt !== undefined) templateData.pageWidthPt = String(template.pageWidthPt);
    if (template.pageHeightPt !== undefined) templateData.pageHeightPt = String(template.pageHeightPt);
    if (template.xPt !== undefined) templateData.xPt = String(template.xPt);
    if (template.yPt !== undefined) templateData.yPt = String(template.yPt);
    if (template.wPt !== undefined) templateData.wPt = String(template.wPt);
    if (template.hPt !== undefined) templateData.hPt = String(template.hPt);
  }

  for (const col of TEMPLATE_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && templateData[col] !== undefined) {
      rowData[index] = templateData[col];
    }
  }

  console.log(`[Templates] Appending template for fmKey: ${template.fmKey}`);

  // Append row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: formatSheetRange(sheetName, getColumnRange(TEMPLATE_COLUMNS.length)),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Templates] Appended template: ${template.fmKey}`);
}

/**
 * Update an existing template row in Google Sheets.
 */
async function updateTemplateRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  template: Template
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

  // Map template fields to columns
  // Each template is independent - write only what's appropriate for its coordSystem
  const templateData: Record<string, string> = {
    userId: template.userId,
    fmKey: template.fmKey,
    templateId: template.templateId,
    page: String(template.page),
    dpi: template.dpi !== undefined ? String(template.dpi) : "",
    coordSystem: template.coordSystem || "",
    updated_at: template.updated_at,
  };

  // PDF_POINTS templates: points are source of truth, percentages set to empty
  if (template.coordSystem === "PDF_POINTS" || template.coordSystem === "PDF_POINTS_TOP_LEFT") {
    templateData.pageWidthPt = template.pageWidthPt !== undefined ? String(template.pageWidthPt) : "";
    templateData.pageHeightPt = template.pageHeightPt !== undefined ? String(template.pageHeightPt) : "";
    templateData.xPt = template.xPt !== undefined ? String(template.xPt) : "";
    templateData.yPt = template.yPt !== undefined ? String(template.yPt) : "";
    templateData.wPt = template.wPt !== undefined ? String(template.wPt) : "";
    templateData.hPt = template.hPt !== undefined ? String(template.hPt) : "";
    // Set percentages to empty to avoid accidental fallback
    templateData.xPct = "";
    templateData.yPct = "";
    templateData.wPct = "";
    templateData.hPct = "";
  } else {
    // Legacy templates: write percentages (and points if available)
    templateData.xPct = String(template.xPct);
    templateData.yPct = String(template.yPct);
    templateData.wPct = String(template.wPct);
    templateData.hPct = String(template.hPct);
    // Include points if available (for future migration)
    if (template.pageWidthPt !== undefined) templateData.pageWidthPt = String(template.pageWidthPt);
    if (template.pageHeightPt !== undefined) templateData.pageHeightPt = String(template.pageHeightPt);
    if (template.xPt !== undefined) templateData.xPt = String(template.xPt);
    if (template.yPt !== undefined) templateData.yPt = String(template.yPt);
    if (template.wPt !== undefined) templateData.wPt = String(template.wPt);
    if (template.hPt !== undefined) templateData.hPt = String(template.hPt);
  }

  for (const col of TEMPLATE_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && templateData[col] !== undefined) {
      rowData[index] = templateData[col];
    }
  }

  console.log(`[Templates] Updating template row ${rowIndex} for fmKey: ${template.fmKey}`);

  // Update row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Templates] Updated template: ${template.fmKey}`);
}

/**
 * Parse a template from a Sheets row.
 */
function parseTemplateFromRow(
  row: string[],
  headers: string[]
): Template | undefined {
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  const getValue = (colName: string): string | undefined => {
    const index = headersLower.indexOf(colName.toLowerCase());
    return index !== -1 && row[index] ? String(row[index]).trim() : undefined;
  };

  const userId = getValue("userId");
  const fmKey = getValue("fmKey");
  const templateId = getValue("templateId");
  const page = getValue("page");
  const xPct = getValue("xPct");
  const yPct = getValue("yPct");
  const wPct = getValue("wPct");
  const hPct = getValue("hPct");
  const dpi = getValue("dpi");
  const coordSystem = getValue("coordSystem");
  const pageWidthPt = getValue("pageWidthPt");
  const pageHeightPt = getValue("pageHeightPt");
  const xPt = getValue("xPt");
  const yPt = getValue("yPt");
  const wPt = getValue("wPt");
  const hPt = getValue("hPt");

  // POINTS-ONLY mode: Require points fields. Allow pct fallback ONLY if points are missing (transition period)
  // Check if values exist and are not empty strings
  const hasPoints = xPt && xPt.trim() !== "" && 
                    yPt && yPt.trim() !== "" && 
                    wPt && wPt.trim() !== "" && 
                    hPt && hPt.trim() !== "" && 
                    pageWidthPt && pageWidthPt.trim() !== "" && 
                    pageHeightPt && pageHeightPt.trim() !== "";
  const hasPct = xPct && xPct.trim() !== "" && 
                 yPct && yPct.trim() !== "" && 
                 wPct && wPct.trim() !== "" && 
                 hPct && hPct.trim() !== "";
  
  // If no points and no pct, template is invalid
  if (!fmKey || !page || (!hasPoints && !hasPct)) {
    return undefined;
  }

  try {
    const template: Template = {
      userId: userId || "", // Default to empty string if not present (for backward compatibility)
      fmKey,
      templateId: templateId || fmKey, // Default to fmKey if templateId not set
      page: parseInt(page, 10),
      // Parse pct only if they exist (may be empty strings in points-only mode)
      xPct: xPct && xPct.trim() !== "" ? parseFloat(xPct) : 0,
      yPct: yPct && yPct.trim() !== "" ? parseFloat(yPct) : 0,
      wPct: wPct && wPct.trim() !== "" ? parseFloat(wPct) : 0,
      hPct: hPct && hPct.trim() !== "" ? parseFloat(hPct) : 0,
      dpi: dpi ? parseFloat(dpi) : undefined,
      // Normalize coordSystem: "PDF_POINTS" from sheet -> "PDF_POINTS_TOP_LEFT" internally
      coordSystem: coordSystem === "PDF_POINTS" ? "PDF_POINTS_TOP_LEFT" : (coordSystem || undefined),
      pageWidthPt: pageWidthPt ? parseFloat(pageWidthPt) : undefined,
      pageHeightPt: pageHeightPt ? parseFloat(pageHeightPt) : undefined,
      // Read points in explicit x,y,w,h order from named columns (not reordered)
      xPt: xPt ? parseFloat(xPt) : undefined,
      yPt: yPt ? parseFloat(yPt) : undefined,
      wPt: wPt ? parseFloat(wPt) : undefined,
      hPt: hPt ? parseFloat(hPt) : undefined,
      updated_at: getValue("updated_at") || new Date().toISOString(),
    };
    
    // Log readback to verify order
    if (template.xPt !== undefined && template.yPt !== undefined && 
        template.wPt !== undefined && template.hPt !== undefined) {
      console.log(`[Templates] Read template points (x,y,w,h order):`, {
        fmKey: template.fmKey,
        xPt: template.xPt,
        yPt: template.yPt,
        wPt: template.wPt,
        hPt: template.hPt,
        pageWidthPt: template.pageWidthPt,
        pageHeightPt: template.pageHeightPt,
      });
    }

    // Validate values
    // POINTS-ONLY: If points exist, validate them. Otherwise validate pct (legacy fallback)
    if (hasPoints) {
      // Validate points are finite numbers
      if (
        isNaN(template.page) ||
        template.xPt === undefined || !Number.isFinite(template.xPt) ||
        template.yPt === undefined || !Number.isFinite(template.yPt) ||
        template.wPt === undefined || !Number.isFinite(template.wPt) ||
        template.hPt === undefined || !Number.isFinite(template.hPt) ||
        template.pageWidthPt === undefined || !Number.isFinite(template.pageWidthPt) ||
        template.pageHeightPt === undefined || !Number.isFinite(template.pageHeightPt)
      ) {
        return undefined;
      }
    } else {
      // Legacy fallback: validate percentages
      if (
        isNaN(template.page) ||
        template.xPct === undefined || isNaN(template.xPct) ||
        template.yPct === undefined || isNaN(template.yPct) ||
        template.wPct === undefined || isNaN(template.wPct) ||
        template.hPct === undefined || isNaN(template.hPct)
      ) {
        return undefined;
      }
    }

    return template;
  } catch (error) {
    console.warn(`[Templates] Error parsing template row:`, error);
    return undefined;
  }
}

