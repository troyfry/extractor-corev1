import { getSheetHeadersCached, findRowIndexByColumnValue } from "@/lib/google/sheets";
import { SIGNED_NEEDS_REVIEW_SHEET_NAME } from "./signedSheets";

const WORK_ORDERS_SHEET_NAME = process.env.GOOGLE_SHEETS_WORK_ORDERS_SHEET_NAME || "Work_Orders";

export interface CheckSignedPdfResult {
  exists: boolean;
  foundIn?: "WORK_ORDERS" | "NEEDS_REVIEW_SIGNED";
  rowIndex?: number;
}

/**
 * Check if a signed PDF has already been processed by searching for file_hash.
 * Uses column-only reads for efficiency.
 * 
 * @param accessToken - Google OAuth access token
 * @param spreadsheetId - Google Sheets spreadsheet ID
 * @param fileHash - SHA-256 hash of the PDF file
 * @param windowDays - Optional: only check records within this many days (not implemented yet)
 * @returns Result indicating if file was found and where
 */
export async function checkSignedPdfAlreadyProcessed({
  accessToken,
  spreadsheetId,
  fileHash,
  windowDays,
}: {
  accessToken: string;
  spreadsheetId: string;
  fileHash: string;
  windowDays?: number;
}): Promise<CheckSignedPdfResult> {
  // 1) Check Work_Orders sheet first
  try {
    const workOrdersHeaders = await getSheetHeadersCached(accessToken, spreadsheetId, WORK_ORDERS_SHEET_NAME);
    const fileHashLetter = workOrdersHeaders.colLetterByLower["file_hash"];
    
    if (fileHashLetter) {
      const rowIndex = await findRowIndexByColumnValue(
        accessToken,
        spreadsheetId,
        WORK_ORDERS_SHEET_NAME,
        fileHashLetter,
        fileHash
      );
      
      if (rowIndex !== -1) {
        return {
          exists: true,
          foundIn: "WORK_ORDERS",
          rowIndex,
        };
      }
    }
  } catch (error) {
    // Sheet might not exist or column might not exist yet - continue to check Needs_Review_Signed
    console.warn(`[Dedupe] Error checking Work_Orders:`, error);
  }

  // 2) Check Needs_Review_Signed sheet
  try {
    const needsReviewHeaders = await getSheetHeadersCached(accessToken, spreadsheetId, SIGNED_NEEDS_REVIEW_SHEET_NAME);
    const fileHashLetter = needsReviewHeaders.colLetterByLower["file_hash"];
    
    if (fileHashLetter) {
      const rowIndex = await findRowIndexByColumnValue(
        accessToken,
        spreadsheetId,
        SIGNED_NEEDS_REVIEW_SHEET_NAME,
        fileHashLetter,
        fileHash
      );
      
      if (rowIndex !== -1) {
        return {
          exists: true,
          foundIn: "NEEDS_REVIEW_SIGNED",
          rowIndex,
        };
      }
    }
  } catch (error) {
    // Sheet might not exist or column might not exist yet
    console.warn(`[Dedupe] Error checking Needs_Review_Signed:`, error);
  }

  return {
    exists: false,
  };
}

