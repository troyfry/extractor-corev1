/**
 * Google Drive API client for storing PDF documents.
 * 
 * PDFs are stored in Google Drive and URLs are stored in Google Sheets.
 */

import { google } from "googleapis";
import { Readable } from "stream";

/**
 * Create a Google Drive API client using an OAuth access token.
 */
export function createDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

/**
 * Upload a PDF file to Google Drive.
 * 
 * @param accessToken Google OAuth access token
 * @param fileBuffer PDF file buffer
 * @param filename Filename for the PDF
 * @param folderId Optional folder ID to upload to (creates in root if not provided)
 * @returns File ID and web view link
 */
export async function uploadPdfToDrive(
  accessToken: string,
  fileBuffer: Buffer,
  filename: string,
  folderId?: string
): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
  const drive = createDriveClient(accessToken);

  try {
    // Prepare file metadata
    const fileMetadata: any = {
      name: filename,
      mimeType: "application/pdf",
    };

    // Add folder parent if provided
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    // Convert Buffer to Readable stream (required by googleapis)
    const bufferStream = Readable.from(fileBuffer);

    // Upload file
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: "application/pdf",
        body: bufferStream,
      },
      fields: "id, webViewLink, webContentLink",
    });

    const fileId = response.data.id;
    const webViewLink = response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
    const webContentLink = response.data.webContentLink || webViewLink;

    if (!fileId) {
      throw new Error("Failed to get file ID from Drive upload");
    }

    console.log(`[Drive] Uploaded PDF to Drive: ${filename} (ID: ${fileId})`);

    return {
      fileId,
      webViewLink,
      webContentLink,
    };
  } catch (error) {
    console.error("[Drive] Error uploading PDF to Drive:", error);
    throw error;
  }
}

/**
 * Create or get a folder in Google Drive.
 * 
 * @param accessToken Google OAuth access token
 * @param folderName Name of the folder
 * @param parentFolderId Optional parent folder ID (creates in root if not provided)
 * @returns Folder ID
 */
export async function getOrCreateFolder(
  accessToken: string,
  folderName: string,
  parentFolderId?: string
): Promise<string> {
  const drive = createDriveClient(accessToken);

  try {
    // Search for existing folder
    let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentFolderId) {
      query += ` and '${parentFolderId}' in parents`;
    } else {
      query += ` and 'root' in parents`;
    }

    const searchResponse = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      pageSize: 1,
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      const folderId = searchResponse.data.files[0].id;
      if (folderId) {
        console.log(`[Drive] Found existing folder: ${folderName} (ID: ${folderId})`);
        return folderId;
      }
    }

    // Create folder if it doesn't exist
    const folderMetadata: any = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    };

    if (parentFolderId) {
      folderMetadata.parents = [parentFolderId];
    }

    const createResponse = await drive.files.create({
      requestBody: folderMetadata,
      fields: "id",
    });

    const folderId = createResponse.data.id;
    if (!folderId) {
      throw new Error("Failed to create folder in Drive");
    }

    console.log(`[Drive] Created folder: ${folderName} (ID: ${folderId})`);
    return folderId;
  } catch (error) {
    console.error("[Drive] Error getting/creating folder:", error);
    throw error;
  }
}

