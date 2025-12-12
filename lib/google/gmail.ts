/**
 * Gmail API client helpers.
 * 
 * These functions use the Google OAuth access token to interact with Gmail API.
 * All functions are stateless and do not touch the database.
 */

import { google } from "googleapis";
import { WORK_ORDER_LABEL_NAME } from "./gmailConfig";

/**
 * Create a Gmail API client using an OAuth access token.
 */
export function createGmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

/**
 * Cached label ID to avoid repeated API calls.
 */
let cachedLabelId: string | null = null;

/**
 * Get the Gmail label ID for the work orders label by name.
 * 
 * @param accessToken Google OAuth access token
 * @returns Label ID if found, null otherwise
 */
export async function getWorkOrderLabelId(accessToken: string): Promise<string | null> {
  // Return cached value if available
  if (cachedLabelId) return cachedLabelId;

  try {
    const gmail = createGmailClient(accessToken);
    const res = await gmail.users.labels.list({ userId: "me" });
    const labels = res.data.labels ?? [];

    // Find label by name (case-insensitive)
    const label = labels.find(
      (lbl) => lbl.name?.toLowerCase() === WORK_ORDER_LABEL_NAME.toLowerCase()
    );

    cachedLabelId = label?.id ?? null;
    return cachedLabelId;
  } catch (error) {
    console.error("Error fetching Gmail labels:", error);
    return null;
  }
}

/**
 * Remove the work orders label from a Gmail message.
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @returns true if successful, false otherwise
 */
export async function removeWorkOrderLabel(
  accessToken: string,
  messageId: string
): Promise<boolean> {
  try {
    const gmail = createGmailClient(accessToken);
    const labelId = await getWorkOrderLabelId(accessToken);

    if (!labelId) {
      console.warn(
        `Work order label "${WORK_ORDER_LABEL_NAME}" not found. Cannot remove label from message ${messageId}.`
      );
      return false;
    }

    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: [labelId],
      },
    });

    console.log(`Successfully removed label "${WORK_ORDER_LABEL_NAME}" from message ${messageId}`);
    return true;
  } catch (error) {
    console.error(`Error removing label from message ${messageId}:`, error);
    return false;
  }
}

/**
 * Type for a found Gmail email with work order metadata.
 */
export type GmailFoundEmail = {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  attachmentCount: number;
};

/**
 * List recent emails with PDF attachments (likely work orders).
 * 
 * @param accessToken Google OAuth access token
 * @param label Optional Gmail label to filter by (e.g., "Work Orders", "INBOX", or label ID)
 * @returns Array of email metadata with PDF attachment counts
 */
export async function listWorkOrderEmails(
  accessToken: string,
  label?: string
): Promise<GmailFoundEmail[]> {
  const gmail = createGmailClient(accessToken);

  // Build search query
  // Gmail search syntax:
  // - has:attachment - finds emails with any attachment
  // - filename:pdf - finds attachments with PDF in filename (may not catch all)
  // We'll search broadly and filter PDFs in code for better accuracy
  let query = "has:attachment";
  let labelIds: string[] | undefined = undefined;
  
  // Add label filter if provided
  // Labels can be specified as:
  // - Label name (e.g., "Work Orders") - use Gmail search syntax: label:"Work Orders"
  // - Special labels like "INBOX", "SENT", "DRAFT", etc. - use: in:INBOX
  // - Label ID (e.g., "Label_1234567890") - use labelIds parameter
  if (label && label.trim()) {
    const trimmedLabel = label.trim();
    
    // Special Gmail labels (INBOX, SENT, DRAFT, etc.)
    const specialLabels = ["INBOX", "SENT", "DRAFT", "SPAM", "TRASH", "UNREAD", "STARRED"];
    const upperLabel = trimmedLabel.toUpperCase();
    
    if (specialLabels.includes(upperLabel)) {
      query += ` in:${upperLabel}`;
    } else if (trimmedLabel.startsWith("Label_")) {
      // Label ID - use labelIds parameter
      labelIds = [trimmedLabel];
    } else {
      // Regular label name - use label:"name" syntax
      query += ` label:"${trimmedLabel}"`;
    }
  }

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults: 20,
    q: query,
    ...(labelIds ? { labelIds } : {}),
  });

  const messages = res.data.messages ?? [];

  if (messages.length === 0) return [];

  // Fetch detailed metadata for each message
  // Use "full" format to get complete message structure for PDF detection
  const detailed = await Promise.all(
    messages.map(async (msg) => {
      try {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full", // Use "full" to get complete payload structure
        });

        const payload = full.data.payload;
        const headers = payload?.headers ?? [];

        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

        const from = getHeader("From");
        const subject = getHeader("Subject");
        const date = getHeader("Date");
        const snippet = full.data.snippet ?? "";

        // Count PDF attachments - need to traverse the full message structure
        let attachmentCount = 0;
        
        /**
         * Recursively traverse message parts to find PDF attachments.
         * Gmail messages can have nested multipart structures.
         */
        function countPdfParts(parts: any[]): void {
          if (!parts || !Array.isArray(parts)) return;
          
          parts.forEach((p) => {
            if (!p) return;
            
            const mimeType = (p.mimeType ?? "").toLowerCase();
            const filename = (p.filename ?? "").toLowerCase();
            const body = p.body ?? {};
            
            // Check if this part is a PDF
            const isPdf = 
              mimeType === "application/pdf" ||
              mimeType.includes("pdf") ||
              filename.endsWith(".pdf");
            
            // PDF attachments have an attachmentId in the body
            if (isPdf && body.attachmentId) {
              attachmentCount += 1;
            }
            
            // Recursively check nested parts (multipart messages)
            if (p.parts && Array.isArray(p.parts) && p.parts.length > 0) {
              countPdfParts(p.parts);
            }
          });
        }

        // Start traversal from root payload
        if (payload) {
          // If payload itself is a PDF (rare but possible)
          const rootMimeType = (payload.mimeType ?? "").toLowerCase();
          const rootFilename = (payload.filename ?? "").toLowerCase();
          if (
            (rootMimeType === "application/pdf" || rootMimeType.includes("pdf") || rootFilename.endsWith(".pdf")) &&
            payload.body?.attachmentId
          ) {
            attachmentCount += 1;
          }
          
          // Traverse parts
          if (payload.parts && Array.isArray(payload.parts)) {
            countPdfParts(payload.parts);
          }
        }

        return {
          id: msg.id!,
          threadId: msg.threadId ?? null,
          from,
          subject,
          date,
          snippet,
          attachmentCount,
        };
      } catch (error) {
        console.error(`Error fetching message ${msg.id}:`, error);
        // Return minimal info if we can't fetch the full message
        return {
          id: msg.id!,
          threadId: msg.threadId ?? null,
          from: "",
          subject: "",
          date: "",
          snippet: "",
          attachmentCount: 0,
        };
      }
    })
  );

  // Filter out emails with 0 PDF attachments (but still return the list for debugging)
  // Return all emails, let the UI show which ones have PDFs

  return detailed;
}

/**
 * Type for a PDF attachment from Gmail.
 */
export type PdfAttachment = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

/**
 * Type for a Gmail email with extracted PDF attachments.
 */
export type EmailWithPdfAttachments = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  pdfAttachments: PdfAttachment[];
};

/**
 * Fetch a Gmail message and extract all PDF attachments.
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @returns Email metadata with PDF attachments as Buffers
 */
export async function getEmailWithPdfAttachments(
  accessToken: string,
  messageId: string
): Promise<EmailWithPdfAttachments> {
  const gmail = createGmailClient(accessToken);
  
  const full = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
  });

  const payload = full.data.payload;
  const headers = payload?.headers ?? [];
  const parts = payload?.parts ?? [];

  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  const pdfAttachments: PdfAttachment[] = [];

  /**
   * Recursively collect PDF attachments from message parts.
   */
  async function collectParts(parts: any[]): Promise<void> {
    for (const part of parts) {
      const mimeType = part.mimeType ?? "";
      const filename = part.filename ?? "";
      const body = part.body ?? {};

      const isPdf =
        mimeType.toLowerCase().includes("pdf") ||
        filename.toLowerCase().endsWith(".pdf");

      if (isPdf && body.attachmentId) {
        const attachRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: body.attachmentId,
        });
        
        const data = attachRes.data.data;
        if (data) {
          const buffer = Buffer.from(data, "base64");
          pdfAttachments.push({
            filename: filename || "attachment.pdf",
            mimeType: mimeType || "application/pdf",
            data: buffer,
          });
        }
      }

      if (part.parts && part.parts.length > 0) {
        await collectParts(part.parts);
      }
    }
  }

  if (parts && parts.length > 0) {
    await collectParts(parts);
  }

  return {
    id: messageId,
    from: getHeader("From"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    snippet: full.data.snippet ?? "",
    pdfAttachments,
  };
}

