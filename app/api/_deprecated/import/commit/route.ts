/**
 * API route to commit import to internal sheet.
 * 
 * Reads external sheet (READ-ONLY), transforms rows, deduplicates, and writes to internal sheet.
 * NEVER writes to external sheet.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { readExternalRows } from "@/lib/_deprecated/importer/readExternalSheet";
import { transformRows } from "@/lib/_deprecated/importer/transformRows";
import { dedupeRecords } from "@/lib/_deprecated/importer/dedupe";
import { writeImportedRecords } from "@/lib/_deprecated/importer/writeToInternalSheet";
import type { ImportMapping } from "@/lib/_deprecated/importer/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.googleAccessToken) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      externalSpreadsheetId,
      sheetName = "Sheet1",
      mapping,
    }: {
      externalSpreadsheetId: string;
      sheetName?: string;
      mapping: ImportMapping;
    } = body;

    if (!externalSpreadsheetId || !mapping || !mapping.wo_number) {
      return NextResponse.json(
        { error: "externalSpreadsheetId and mapping.wo_number are required" },
        { status: 400 }
      );
    }

    // Load workspace to get internal spreadsheet ID
    const workspace = await loadWorkspace();
    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not configured. Please complete onboarding." },
        { status: 400 }
      );
    }

    // READ-ONLY: Read all rows from external sheet
    const { headers: externalHeaders, rows: externalRows } = await readExternalRows(
      user.googleAccessToken,
      externalSpreadsheetId,
      sheetName
    );

    if (externalRows.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        conflicts: 0,
        errors: ["No rows found in external sheet"],
      });
    }

    // Transform external rows to canonical format
    const { records, errors: transformErrors } = transformRows(
      externalRows,
      externalHeaders,
      mapping
    );

    if (records.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        conflicts: 0,
        errors: transformErrors.length > 0 ? transformErrors : ["No valid records to import"],
      });
    }

    // Deduplicate against internal sheet
    const dedupeResults = await dedupeRecords(
      user.googleAccessToken,
      workspace.spreadsheetId,
      records
    );

    // Write to internal sheet (NEVER writes to external sheet)
    const summary = await writeImportedRecords(
      user.googleAccessToken,
      workspace.spreadsheetId,
      records,
      dedupeResults
    );

    // Combine transform errors with write errors
    summary.errors.push(...transformErrors);

    return NextResponse.json({
      ...summary,
      message: `Import complete: ${summary.imported} imported, ${summary.skipped} skipped (duplicates), ${summary.conflicts} conflicts sent to Verification`,
    });
  } catch (error) {
    console.error("[Import Commit API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

