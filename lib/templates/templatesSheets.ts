/**
 * Template crop zone persistence in Google Sheets.
 * 
 * Stores template crop zones in "Templates" tab of the user's Google Sheet.
 * Each row represents a crop zone for a specific fmKey.
 */

import { createSheetsClient } from "@/lib/google/sheets";

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
export async function listTemplatesForUser(
  accessToken: string,
  spreadsheetId: string,
  userId: string
): Promise<Template[]> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Templates";

  try {
    // Ensure sheet exists
    await ensureTemplatesSheet(spreadsheetId, accessToken);

    // Get all data
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "A:Z"),
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
      if (template && template.userId === userId) {
        templates.push(template);
      }
    }

    console.log(`[Templates] Loaded ${templates.length} template(s) for userId: ${userId}`);
    return templates;
  } catch (error: any) {
    console.error(`[Templates] Error getting templates:`, error);
    
    // Check if it's an authentication/authorization error
    if (error?.message?.includes("Invalid Credentials") || 
        error?.message?.includes("unauthorized") ||
        error?.message?.includes("authentication") ||
        error?.code === 401 ||
        error?.code === 403) {
      throw new Error("Google authentication expired or invalid. Please sign out and sign in again.");
    }
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Get template by fmKey for a user.
 */
export async function getTemplateByFmKey(
  accessToken: string,
  spreadsheetId: string,
  userId: string,
  fmKey: string
): Promise<Template | null> {
  const templates = await listTemplatesForUser(accessToken, spreadsheetId, userId);
  const normalizedFmKey = fmKey.toLowerCase().trim();
  return templates.find(t => t.fmKey.toLowerCase().trim() === normalizedFmKey) || null;
}

/**
 * Upsert a template (insert or update).
 * One row per (userId + fmKey). Update if exists, append if missing.
 */
export async function upsertTemplate(
  accessToken: string,
  spreadsheetId: string,
  template: {
    userId: string;
    fmKey: string;
    templateId?: string; // Optional, defaults to fmKey
    page: number;
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
    dpi?: number;
  }
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Templates";

  // Ensure sheet exists with headers
  await ensureTemplatesSheet(spreadsheetId, accessToken);

  const templateId = template.templateId || template.fmKey;
  const normalizedFmKey = template.fmKey.toLowerCase().trim();

  try {
    // Get all data to find existing row by userId + fmKey
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, "A:Z"),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      // No data, just append
      await appendTemplateRow(sheets, spreadsheetId, sheetName, {
        ...template,
        templateId,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Find row index by userId + fmKey
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

    if (userIdColIndex === -1 || fmKeyColIndex === -1) {
      // Required columns not found, just append
      await appendTemplateRow(sheets, spreadsheetId, sheetName, {
        ...template,
        templateId,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Find existing row by userId + fmKey
    let existingRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowUserId = (row?.[userIdColIndex] || "").trim();
      const rowFmKey = (row?.[fmKeyColIndex] || "").trim().toLowerCase();
      if (rowUserId === template.userId && rowFmKey === normalizedFmKey) {
        existingRowIndex = i + 1; // +1 because Sheets is 1-indexed
        break;
      }
    }

    // Check for duplicate templateId (if templateId column exists)
    if (templateIdColIndex !== -1) {
      const normalizedTemplateId = templateId.toLowerCase().trim();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowUserId = (row?.[userIdColIndex] || "").trim();
        const rowTemplateId = (row?.[templateIdColIndex] || "").trim().toLowerCase();
        const rowFmKey = (row?.[fmKeyColIndex] || "").trim().toLowerCase();
        
        // Check if templateId already exists for this user
        if (rowUserId === template.userId && rowTemplateId === normalizedTemplateId) {
          // If it's the same row we're updating (by fmKey), that's OK
          if (existingRowIndex !== -1 && i + 1 === existingRowIndex) {
            continue; // Same row, allow update
          }
          // Otherwise, it's a duplicate templateId for a different fmKey
          throw new Error(
            `Template ID "${templateId}" already exists for this user (FM Key: ${rowFmKey}). Each template ID must be unique.`
          );
        }
      }
    }

    if (existingRowIndex === -1) {
      // Row doesn't exist, append it
      await appendTemplateRow(sheets, spreadsheetId, sheetName, {
        ...template,
        templateId,
        updated_at: new Date().toISOString(),
      });
    } else {
      // Row exists, update it
      await updateTemplateRow(sheets, spreadsheetId, sheetName, existingRowIndex, {
        ...template,
        templateId,
        updated_at: new Date().toISOString(),
      });
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
  const templateData: Record<string, string> = {
    userId: template.userId,
    fmKey: template.fmKey,
    templateId: template.templateId,
    page: String(template.page),
    xPct: String(template.xPct),
    yPct: String(template.yPct),
    wPct: String(template.wPct),
    hPct: String(template.hPct),
    dpi: template.dpi !== undefined ? String(template.dpi) : "",
    updated_at: template.updated_at,
  };

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
    range: formatSheetRange(sheetName, "A:Z"),
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
  const templateData: Record<string, string> = {
    userId: template.userId,
    fmKey: template.fmKey,
    templateId: template.templateId,
    page: String(template.page),
    xPct: String(template.xPct),
    yPct: String(template.yPct),
    wPct: String(template.wPct),
    hPct: String(template.hPct),
    dpi: template.dpi !== undefined ? String(template.dpi) : "",
    updated_at: template.updated_at,
  };

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

  if (!userId || !fmKey || !page || !xPct || !yPct || !wPct || !hPct) {
    return undefined;
  }

  try {
    const template: Template = {
      userId,
      fmKey,
      templateId: templateId || fmKey, // Default to fmKey if templateId not set
      page: parseInt(page, 10),
      xPct: parseFloat(xPct),
      yPct: parseFloat(yPct),
      wPct: parseFloat(wPct),
      hPct: parseFloat(hPct),
      dpi: dpi ? parseFloat(dpi) : undefined,
      updated_at: getValue("updated_at") || new Date().toISOString(),
    };

    // Validate values
    if (
      isNaN(template.page) ||
      isNaN(template.xPct) ||
      isNaN(template.yPct) ||
      isNaN(template.wPct) ||
      isNaN(template.hPct)
    ) {
      return undefined;
    }

    return template;
  } catch (error) {
    console.warn(`[Templates] Error parsing template row:`, error);
    return undefined;
  }
}

