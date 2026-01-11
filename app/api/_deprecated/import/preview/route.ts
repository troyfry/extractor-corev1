/**
 * API route to preview import with deduplication.
 * 
 * Reads external sheet (READ-ONLY), transforms rows, and checks for duplicates.
 * Does NOT write to any sheets.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { readExternalRows } from "@/lib/_deprecated/importer/readExternalSheet";
import { transformRows } from "@/lib/_deprecated/importer/transformRows";
import { dedupeRecords } from "@/lib/_deprecated/importer/dedupe";
import type { ImportMapping, ImportPreview } from "@/lib/_deprecated/importer/types";

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
      previewLimit = 10,
    }: {
      externalSpreadsheetId: string;
      sheetName?: string;
      mapping: ImportMapping;
      previewLimit?: number;
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

    // READ-ONLY: Read external sheet (limited rows for preview)
    const { headers: externalHeaders, rows: externalRows } = await readExternalRows(
      user.googleAccessToken,
      externalSpreadsheetId,
      sheetName,
      previewLimit
    );

    if (externalRows.length === 0) {
      return NextResponse.json({
        totalRows: 0,
        newCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        sampleRows: [],
        errors: [],
      } as ImportPreview);
    }

    // Transform external rows to canonical format
    const { records, errors: transformErrors } = transformRows(
      externalRows,
      externalHeaders,
      mapping
    );

    // Deduplicate against internal sheet
    const dedupeResults = await dedupeRecords(
      user.googleAccessToken,
      workspace.spreadsheetId,
      records
    );

    // Count results
    let newCount = 0;
    let duplicateCount = 0;
    let conflictCount = 0;

    const sampleRows = records.slice(0, Math.min(5, records.length)).map((record, index) => {
      const dedupe = dedupeResults.get(index);
      if (!dedupe) return null;

      if (dedupe.status === "new") newCount++;
      else if (dedupe.status === "duplicate") duplicateCount++;
      else if (dedupe.status === "conflict") conflictCount++;

      // Map external row back to object for display
      const externalRow: Record<string, string> = {};
      externalHeaders.forEach((header, idx) => {
        externalRow[header] = externalRows[index]?.[idx] || "";
      });

      return {
        externalRow,
        canonical: record,
        dedupe,
      };
    }).filter(Boolean) as ImportPreview["sampleRows"];

    // Count all rows (not just sample)
    for (let i = 0; i < records.length; i++) {
      const dedupe = dedupeResults.get(i);
      if (dedupe?.status === "new") newCount++;
      else if (dedupe?.status === "duplicate") duplicateCount++;
      else if (dedupe?.status === "conflict") conflictCount++;
    }

    const preview: ImportPreview = {
      totalRows: externalRows.length,
      newCount,
      duplicateCount,
      conflictCount,
      sampleRows,
      errors: transformErrors,
    };

    return NextResponse.json(preview);
  } catch (error) {
    console.error("[Import Preview API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

