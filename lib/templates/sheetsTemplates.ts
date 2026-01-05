/**
 * Per-user template persistence in Google Sheets.
 * 
 * Stores work order templates in a "Settings" tab of the user's Google Sheet.
 * Each row represents a template for a specific issuerKey.
 * 
 * Uses the same OAuth token patterns as other Pro features.
 * Requires: https://www.googleapis.com/auth/spreadsheets scope
 */

import { createSheetsClient } from "@/lib/google/sheets";
import type { WorkOrderTemplate, WorkOrderNumberZone } from "./workOrders";
import type { FmProfile } from "./fmProfiles";
import { getColumnRange } from "@/lib/google/sheetsCache";

/**
 * Required columns for template storage in Google Sheets.
 * 
 * ⚠️ POINTS-ONLY: PDF points are required. Percentage columns are deprecated.
 */
const TEMPLATE_COLUMNS = [
  "issuerKey",
  "templateId",
  "label",
  "page",
  "xPct", // Deprecated - always empty string
  "yPct", // Deprecated - always empty string
  "wPct", // Deprecated - always empty string
  "hPct", // Deprecated - always empty string
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
 * Sheet names with spaces or special characters must be quoted.
 */
function formatSheetRange(sheetName: string, range: string = "1:1"): string {
  if (/[\s'"]/.test(sheetName)) {
    return `'${sheetName.replace(/'/g, "''")}'!${range}`;
  }
  return `${sheetName}!${range}`;
}

/**
 * Ensure the "Settings" tab exists with required headers.
 * Creates the sheet if it doesn't exist, and adds missing columns if needed.
 * 
 * Uses spreadsheets.batchUpdate with addSheet (requires spreadsheets scope).
 * 
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param accessToken Google OAuth access token
 */
export async function ensureTemplateSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<void> {
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Settings";

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
      console.log(`[Sheets Templates] Creating "${sheetName}" sheet`);
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
      console.log(`[Sheets Templates] Created "${sheetName}" sheet`);
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
      // All columns exist
      console.log(`[Sheets Templates] "${sheetName}" sheet is ready`);
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

    console.log(`[Sheets Templates] Added ${missingColumns.length} missing columns to "${sheetName}" sheet`);
  } catch (error) {
    console.error(`[Sheets Templates] Error ensuring template sheet:`, error);
    throw error;
  }
}

/**
 * Write or update a template in Google Sheets.
 * Uses issuerKey as the unique identifier (one row per issuerKey).
 * 
 * @param params.spreadsheetId Google Sheets spreadsheet ID
 * @param params.accessToken Google OAuth access token
 * @param params.template Template to save
 */
export async function upsertTemplateToSheet(params: {
  spreadsheetId: string;
  accessToken: string;
  template: WorkOrderTemplate;
}): Promise<void> {
  const { spreadsheetId, accessToken, template } = params;
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Settings";

  // Ensure sheet exists with headers
  await ensureTemplateSheet(spreadsheetId, accessToken);

  try {
    // Get all data to find existing row by issuerKey
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(TEMPLATE_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      // No data, just append
      await appendTemplateRow(sheets, spreadsheetId, sheetName, template);
      return;
    }

    // Find row index by issuerKey (issuerKey is in first column)
    const headers = rows[0] as string[];
    const issuerKeyColIndex = headers.findIndex(
      (h) => h.toLowerCase().trim() === "issuerkey"
    );

    if (issuerKeyColIndex === -1) {
      // issuerKey column not found, just append
      await appendTemplateRow(sheets, spreadsheetId, sheetName, template);
      return;
    }

    // Find existing row by issuerKey
    let existingRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[issuerKeyColIndex] === template.issuerKey) {
        existingRowIndex = i + 1; // +1 because Sheets is 1-indexed
        break;
      }
    }

    if (existingRowIndex === -1) {
      // Row doesn't exist, append it
      await appendTemplateRow(sheets, spreadsheetId, sheetName, template);
    } else {
      // Row exists, update it
      await updateTemplateRow(sheets, spreadsheetId, sheetName, existingRowIndex, template);
    }
  } catch (error) {
    console.error(`[Sheets Templates] Error upserting template:`, error);
    throw error;
  }
}

/**
 * Get a template from Google Sheets by issuerKey.
 * 
 * @param params.spreadsheetId Google Sheets spreadsheet ID
 * @param params.accessToken Google OAuth access token
 * @param params.issuerKey Issuer key to look up
 * @returns Template zone if found, or undefined
 */
export async function getTemplateFromSheet(params: {
  spreadsheetId: string;
  accessToken: string;
  issuerKey: string;
}): Promise<WorkOrderTemplate | undefined> {
  const { spreadsheetId, accessToken, issuerKey } = params;
  const sheets = createSheetsClient(accessToken);
  const sheetName = "Settings";

  try {
    // Get all data
    const allDataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: formatSheetRange(sheetName, getColumnRange(TEMPLATE_COLUMNS.length)),
    });

    const rows = allDataResponse.data.values || [];
    if (rows.length === 0) {
      return undefined;
    }

    // Find issuerKey column
    const headers = rows[0] as string[];
    const headersLower = headers.map((h) => h.toLowerCase().trim());
    const issuerKeyColIndex = headersLower.indexOf("issuerkey");

    if (issuerKeyColIndex === -1) {
      return undefined;
    }

    // Find row by issuerKey
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row && row[issuerKeyColIndex] === issuerKey) {
        // Found matching row, parse it into a template
        return parseTemplateFromRow(row, headers);
      }
    }

    return undefined;
  } catch (error) {
    console.error(`[Sheets Templates] Error getting template:`, error);
    // Return undefined on error (fail gracefully)
    return undefined;
  }
}

/**
 * Append a new template row to Google Sheets.
 * 
 * ⚠️ POINTS-ONLY: All templates must have PDF points. Percentages always set to empty.
 */
async function appendTemplateRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  template: WorkOrderTemplate
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

  const zone = template.woNumberZone;

  // Map template fields to columns
  // POINTS-ONLY: All templates must have PDF points. Percentages always set to empty.
  const templateData: Record<string, string> = {
    issuerKey: template.issuerKey,
    templateId: template.templateId,
    label: template.label,
    page: String(zone.page),
    // Percentages always empty (deprecated columns, leave untouched)
    xPct: "",
    yPct: "",
    wPct: "",
    hPct: "",
    coordSystem: "PDF_POINTS_TOP_LEFT",
    // PDF points from woNumberZone (REQUIRED)
    pageWidthPt: String(zone.pageWidthPt),
    pageHeightPt: String(zone.pageHeightPt),
    xPt: String(zone.xPt),
    yPt: String(zone.yPt),
    wPt: String(zone.wPt),
    hPt: String(zone.hPt),
    updated_at: new Date().toISOString(),
  };

  for (const col of TEMPLATE_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && templateData[col] !== undefined) {
      rowData[index] = templateData[col];
    }
  }

  console.log(`[Sheets Templates] Appending template for issuerKey: ${template.issuerKey}`);

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

  console.log(`[Sheets Templates] Appended template: ${template.templateId}`);
}

/**
 * Update an existing template row in Google Sheets.
 * 
 * ⚠️ POINTS-ONLY: All templates must have PDF points. Percentages always set to empty.
 */
async function updateTemplateRow(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  template: WorkOrderTemplate
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

  const zone = template.woNumberZone;

  // Map template fields to columns
  // POINTS-ONLY: All templates must have PDF points. Percentages always set to empty.
  const templateData: Record<string, string> = {
    issuerKey: template.issuerKey,
    templateId: template.templateId,
    label: template.label,
    page: String(zone.page),
    // Percentages always empty (deprecated columns, leave untouched)
    xPct: "",
    yPct: "",
    wPct: "",
    hPct: "",
    coordSystem: "PDF_POINTS_TOP_LEFT",
    // PDF points from woNumberZone (REQUIRED)
    pageWidthPt: String(zone.pageWidthPt),
    pageHeightPt: String(zone.pageHeightPt),
    xPt: String(zone.xPt),
    yPt: String(zone.yPt),
    wPt: String(zone.wPt),
    hPt: String(zone.hPt),
    updated_at: new Date().toISOString(),
  };

  for (const col of TEMPLATE_COLUMNS) {
    const index = headersLower.indexOf(col.toLowerCase());
    if (index !== -1 && templateData[col] !== undefined) {
      rowData[index] = templateData[col];
    }
  }

  console.log(`[Sheets Templates] Updating template row ${rowIndex} for issuerKey: ${template.issuerKey}`);

  // Update row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: formatSheetRange(sheetName, `${rowIndex}:${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData],
    },
  });

  console.log(`[Sheets Templates] Updated template: ${template.templateId}`);
}

/**
 * Parse a template from a Sheets row.
 */
function parseTemplateFromRow(
  row: string[],
  headers: string[]
): WorkOrderTemplate | undefined {
  const headersLower = headers.map((h) => h.toLowerCase().trim());

  const getValue = (colName: string): string | undefined => {
    const index = headersLower.indexOf(colName.toLowerCase());
    return index !== -1 && row[index] ? String(row[index]).trim() : undefined;
  };

  const issuerKey = getValue("issuerKey");
  const templateId = getValue("templateId");
  const label = getValue("label");
  const page = getValue("page");
  const pageWidthPt = getValue("pageWidthPt");
  const pageHeightPt = getValue("pageHeightPt");
  const xPt = getValue("xPt");
  const yPt = getValue("yPt");
  const wPt = getValue("wPt");
  const hPt = getValue("hPt");

  // POINTS-ONLY: Require PDF points. No percentage fallback.
  if (!issuerKey || !templateId || !label || !page || 
      !pageWidthPt || !pageHeightPt || !xPt || !yPt || !wPt || !hPt) {
    console.warn(`[Sheets Templates] Incomplete template row, missing required PDF points fields`);
    return undefined;
  }

  try {
    const pageNum = parseInt(page, 10);
    const pageWidthPtNum = parseFloat(pageWidthPt);
    const pageHeightPtNum = parseFloat(pageHeightPt);
    const xPtNum = parseFloat(xPt);
    const yPtNum = parseFloat(yPt);
    const wPtNum = parseFloat(wPt);
    const hPtNum = parseFloat(hPt);

    // Validate points are finite numbers
    if (
      isNaN(pageNum) ||
      !Number.isFinite(pageWidthPtNum) || !Number.isFinite(pageHeightPtNum) ||
      !Number.isFinite(xPtNum) || !Number.isFinite(yPtNum) ||
      !Number.isFinite(wPtNum) || !Number.isFinite(hPtNum)
    ) {
      console.warn(`[Sheets Templates] Invalid PDF points values in template row`);
      return undefined;
    }

    // Return template with points in woNumberZone
    const zone: WorkOrderNumberZone = {
      page: pageNum,
      xPt: xPtNum,
      yPt: yPtNum,
      wPt: wPtNum,
      hPt: hPtNum,
      pageWidthPt: pageWidthPtNum,
      pageHeightPt: pageHeightPtNum,
    };

    return {
      issuerKey,
      templateId,
      label,
      woNumberZone: zone,
    };
  } catch (error) {
    console.warn(`[Sheets Templates] Error parsing template row:`, error);
    return undefined;
  }
}

