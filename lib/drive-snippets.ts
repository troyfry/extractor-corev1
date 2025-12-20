/**
 * Google Drive helper for uploading snippet images (PNG) to a public folder.
 * 
 * Uploads PNG buffers to Google Drive and makes them publicly accessible.
 */

import { google } from "googleapis";
import { Readable } from "stream";

/**
 * Create a Google Drive API client using an OAuth access token.
 */
function createDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

/**
 * Upload a PNG snippet image to Google Drive and make it publicly accessible.
 * 
 * @param args.accessToken - Google OAuth access token
 * @param args.fileName - Filename for the PNG (e.g., "snippet-123.png")
 * @param args.pngBuffer - PNG image buffer
 * @param args.folderIdOverride - Optional folder ID override (defaults to env var)
 * @returns Public web view link or null if upload fails
 */
export async function uploadSnippetImageToDrive(args: {
  accessToken: string;
  fileName: string;
  pngBuffer: Buffer;
  folderIdOverride?: string;
}): Promise<string | null> {
  const { accessToken, fileName, pngBuffer, folderIdOverride } = args;

  // Get folder ID from override or environment variable
  const folderId = folderIdOverride || process.env.GOOGLE_DRIVE_SNIPPETS_FOLDER_ID;

  if (!folderId) {
    console.warn(
      "[Drive Snippets] No folder ID available. Set GOOGLE_DRIVE_SNIPPETS_FOLDER_ID or provide folderIdOverride."
    );
    return null;
  }

  const drive = createDriveClient(accessToken);

  try {
    // Convert Buffer to Readable stream (required by googleapis)
    const bufferStream = Readable.from(pngBuffer);

    // Upload file
    const uploadResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType: "image/png",
      },
      media: {
        mimeType: "image/png",
        body: bufferStream,
      },
      fields: "id, webViewLink, webContentLink",
    });

    const fileId = uploadResponse.data.id;
    const webViewLink = uploadResponse.data.webViewLink;
    const webContentLink = uploadResponse.data.webContentLink;

    if (!fileId) {
      console.error("[Drive Snippets] Failed to get file ID from Drive upload");
      return null;
    }

    // Make file publicly readable
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const publicLink = webViewLink || webContentLink || null;

    console.log("[Drive Snippets] Uploaded snippet", {
      fileId,
      fileName,
      link: publicLink,
    });

    return publicLink;
  } catch (error) {
    console.error("[Drive Snippets] Error uploading snippet to Drive:", error);
    if (error instanceof Error) {
      console.error("[Drive Snippets] Error details:", {
        message: error.message,
        stack: error.stack,
      });
    }
    return null;
  }
}

