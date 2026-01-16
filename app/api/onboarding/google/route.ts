/**
 * API route for creating and setting up Google Workspace during onboarding.
 * 
 * Creates a new Google Drive folder and Google Sheets spreadsheet based on provided names.
 * Sets up required tabs, headers, and configuration.
 * 
 * POST /api/onboarding/google
 * Body: { sheetName: string, folderName?: string }
 * Returns: { folderId: string, spreadsheetId: string, folderUrl: string, sheetUrl: string }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { resetApiCallCount, getApiCallCount } from "@/lib/onboarding/usersSheet";
import { getOrCreateFolder } from "@/lib/google/drive";
import { createSheetsClient } from "@/lib/google/sheets";
import { cookies } from "next/headers";
import { checkRateLimit } from "@/lib/onboarding/rateLimit";

export const runtime = "nodejs";

/**
 * Write headers to Work_Orders sheet (idempotent - skips if headers already exist).
 * Note: Tab name is "Work_Orders" (with underscore) to match codebase convention.
 * UI copy may say "Work Orders" but the actual tab name uses underscore.
 */
async function writeWorkOrdersHeaders(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string
): Promise<void> {
  const headers = [
    "work_order_number",
    "scheduled_date",
    "created_at",
    "timestamp_extracted",
    "customer_name",
    "vendor_name",
    "service_address",
    "job_type",
    "job_description",
    "amount",
    "currency",
    "notes",
    "priority",
    "calendar_event_link",
    "work_order_pdf_link",
    "user_id",
    "job_id",
  ];

  // Check if headers already exist (idempotent) - read just A1 for faster check
  try {
    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Work_Orders!A1",
    });
    
    const existingCell = existingResponse.data.values?.[0]?.[0];
    if (existingCell === "work_order_number") {
      console.log(`[Setup Workspace] Work_Orders headers already exist, skipping write`);
      return;
    }
  } catch {
    // If read fails (empty sheet or tab doesn't exist), proceed to write
    console.log(`[Setup Workspace] Could not read existing headers, proceeding to write`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Work_Orders!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [headers],
    },
  });

  console.log(`[Setup Workspace] ✅ Wrote headers to Work_Orders sheet`);
}

/**
 * Write config to Config tab (idempotent - overwrites existing config cleanly).
 * Writes header row and all config rows in a single update call.
 */
async function writeConfig(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  config: {
    version: string;
    folderName: string;
    folderId: string;
    sheetName: string;
    spreadsheetId: string;
    createdAt: string;
  }
): Promise<void> {
  // Write header row + all config rows in a single update (overwrites cleanly)
  const configData = [
    ["key", "value"], // Header row
    ["version", config.version],
    ["folderName", config.folderName],
    ["folderId", config.folderId],
    ["sheetName", config.sheetName],
    ["spreadsheetId", config.spreadsheetId],
    ["createdAt", config.createdAt],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Config!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: configData,
    },
  });

  console.log(`[Setup Workspace] ✅ Wrote config to Config tab`);
}

export async function POST(request: Request) {
  resetApiCallCount();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google OAuth token not available. Please sign in again." },
        { status: 401 }
      );
    }

    // Rate limiting: prevent spam calls
    const rateLimitKey = `google:${user.userId}`;
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    // Short-circuit: prevent duplicate spreadsheets if workspace already ready (idempotent)
    const cookieStore = await cookies();
    const workspaceReady = cookieStore.get("workspaceReady")?.value;
    const existingWorkspaceId = cookieStore.get("workspaceId")?.value;
    const existingSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value;
    const existingFolderId = cookieStore.get("googleDriveFolderId")?.value;

    // If workspace is ready and we have folder ID, try to find workspace in DB
    if (workspaceReady === "true" && existingFolderId) {
      // If we don't have workspaceId cookie, try to find it from DB
      let workspaceId = existingWorkspaceId;
      if (!workspaceId) {
        const { getOrCreateWorkspace } = await import("@/lib/db/services/workspace");
        workspaceId = await getOrCreateWorkspace(
          existingFolderId,
          user.userId,
          existingSpreadsheetId || null,
          null // name not needed for resume
        );
        console.log(`[Setup Workspace] Resumed - found/created workspace in DB: ${workspaceId}`);
      }

      const response = NextResponse.json({
        folderId: existingFolderId,
        spreadsheetId: existingSpreadsheetId || null,
        folderUrl: `https://drive.google.com/drive/folders/${existingFolderId}`,
        sheetUrl: existingSpreadsheetId ? `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit` : null,
        workspaceId,
        exportEnabled: !!existingSpreadsheetId,
        resumed: true,
      });
      
      // Ensure workspaceId cookie is set (even if we just found it)
      if (workspaceId) {
        response.cookies.set("workspaceId", workspaceId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });
      }
      
      return response;
    }

    const body = await request.json();
    const { sheetName, folderName, enableExport } = body;

    // sheetName is now optional - only required if enableExport is true
    if (enableExport && (!sheetName || typeof sheetName !== "string" || !sheetName.trim())) {
      return NextResponse.json(
        { error: "sheetName is required when enableExport is true" },
        { status: 400 }
      );
    }

    const finalFolderName = (folderName && typeof folderName === "string" && folderName.trim()) 
      ? folderName.trim() 
      : "Work Orders";
    const finalSheetName = sheetName?.trim() || null;
    const shouldEnableExport = enableExport === true;

    console.log(`[Setup Workspace] Setting up workspace: folder="${finalFolderName}", export=${shouldEnableExport}`);

    // Step 1: Find or create Drive folder (REQUIRED)
    console.log(`[Setup Workspace] Finding/creating folder: "${finalFolderName}"`);
    const folderId = await getOrCreateFolder(user.googleAccessToken, finalFolderName);
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    console.log(`[Setup Workspace] ✅ Folder ready: ${folderId}`);

    let spreadsheetId: string | null = null;
    let sheetUrl: string | null = null;

    // Step 2: Create spreadsheet ONLY if export is enabled (OPTIONAL)
    if (shouldEnableExport && finalSheetName) {
      console.log(`[Setup Workspace] Export enabled - finding or creating spreadsheet: "${finalSheetName}"`);
      const { findSpreadsheetByName } = await import("@/lib/google/sheets");
      const sheets = createSheetsClient(user.googleAccessToken);
      spreadsheetId = await findSpreadsheetByName(user.googleAccessToken, finalSheetName);
      
      if (spreadsheetId) {
        console.log(`[Setup Workspace] ✅ Found existing spreadsheet: ${spreadsheetId}`);
        sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      } else {
        console.log(`[Setup Workspace] Creating new spreadsheet: "${finalSheetName}"`);
        const createResponse = await sheets.spreadsheets.create({
          requestBody: {
            properties: {
              title: finalSheetName,
            },
          },
        });

        spreadsheetId = createResponse.data.spreadsheetId;
        if (!spreadsheetId) {
          throw new Error("Failed to create spreadsheet");
        }

        sheetUrl = createResponse.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        console.log(`[Setup Workspace] ✅ Spreadsheet created: ${spreadsheetId}`);

        // Step 3: Ensure required tabs exist (only if creating new spreadsheet)
        const requiredTabs = ["Work_Orders", "Verification", "Signatures", "Config"];
        const spreadsheetResponse = await sheets.spreadsheets.get({
          spreadsheetId,
        });
        
        const existingTabs = new Set(
          spreadsheetResponse.data.sheets?.map(s => s.properties?.title).filter(Boolean) || []
        );
        
        const missingTabs = requiredTabs.filter(tabName => !existingTabs.has(tabName));
        
        if (missingTabs.length > 0) {
          console.log(`[Setup Workspace] Creating ${missingTabs.length} missing tab(s): ${missingTabs.join(", ")}`);
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: missingTabs.map(tabName => ({
                addSheet: {
                  properties: {
                    title: tabName,
                  },
                },
              })),
            },
          });
          console.log(`[Setup Workspace] ✅ Created ${missingTabs.length} tab(s)`);
        }

        // Step 4: Write headers to Work_Orders sheet (idempotent)
        await writeWorkOrdersHeaders(sheets, spreadsheetId);

        // Step 5: Write config to Config tab
        const createdAt = new Date().toISOString();
        await writeConfig(sheets, spreadsheetId, {
          version: "v1",
          folderName: finalFolderName,
          folderId,
          sheetName: finalSheetName,
          spreadsheetId,
          createdAt,
        });
      }
    } else {
      console.log(`[Setup Workspace] Export disabled - skipping spreadsheet creation`);
    }

    // Step 6: Create/update workspace in DB (DB-native)
    const { getOrCreateWorkspace } = await import("@/lib/db/services/workspace");
    const workspaceId = await getOrCreateWorkspace(
      folderId,
      user.userId,
      spreadsheetId,
      finalFolderName
    );
    console.log(`[Setup Workspace] ✅ Workspace created in DB: ${workspaceId}`);

    // Store workspace info in cookies
    const response = NextResponse.json({
      folderId,
      spreadsheetId: spreadsheetId || null,
      folderUrl,
      sheetUrl: sheetUrl || null,
      workspaceId,
      exportEnabled: shouldEnableExport,
    });
    
    // Set workspace ID cookie (DB-native)
    response.cookies.set("workspaceId", workspaceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    
    // Store folder ID in cookie
    response.cookies.set("googleDriveFolderId", folderId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
    
    // Store spreadsheet ID in cookie (only if export enabled)
    if (spreadsheetId) {
      response.cookies.set("googleSheetsSpreadsheetId", spreadsheetId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }
    
    // Mark workspace as ready (folder created, spreadsheet optional)
    response.cookies.set("workspaceReady", "true", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    const apiCalls = getApiCallCount();
    console.log(`[Setup Workspace] ✅ Complete. Workspace ID: ${workspaceId}, Export: ${shouldEnableExport}. Sheets API calls: ${apiCalls}`);
    return response;
  } catch (error) {
    console.error("Error setting up workspace:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
