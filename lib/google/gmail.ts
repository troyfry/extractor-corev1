/**
 * Gmail API client helpers.
 * 
 * These functions use the Google OAuth access token to interact with Gmail API.
 * All functions are stateless and do not touch the database.
 */

import { google } from "googleapis";
import { WORK_ORDER_LABEL_NAME } from "./gmailConfig";
import { validateLabelName } from "./gmailValidation";

export type GmailLabel = {
  id: string;
  name: string;
};

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
 * Get Gmail label ID by label name (case-insensitive).
 * 
 * @param accessToken Google OAuth access token
 * @param labelName Label name to search for
 * @returns Label ID if found, null otherwise
 */
export async function getLabelIdByName(
  accessToken: string,
  labelName: string
): Promise<string | null> {
  try {
    const gmail = createGmailClient(accessToken);
    const res = await gmail.users.labels.list({ userId: "me" });
    const labels = res.data.labels ?? [];

    console.log(`[Gmail] Searching for label: "${labelName}"`);
    console.log(`[Gmail] Total labels available: ${labels.length}`);
    
    // Find label by name (case-insensitive)
    const label = labels.find(
      (lbl) => lbl.name?.toLowerCase() === labelName.toLowerCase()
    );

    if (label) {
      console.log(`[Gmail] ✓ Found label "${labelName}" with ID: ${label.id}`);
      console.log(`[Gmail] Label details: name="${label.name}", id="${label.id}", type="${label.type}"`);
      return label.id ?? null;
    } else {
      // Show all user-created labels (not system labels) for debugging
      const userLabels = labels
        .filter(l => l.type === "user")
        .map(l => l.name)
        .filter(Boolean);
      console.warn(`[Gmail] ✗ Label "${labelName}" not found.`);
      console.warn(`[Gmail] User-created labels (first 20):`, userLabels.slice(0, 20).join(", "));
      
      // Also check for close matches
      const closeMatches = labels.filter(l => 
        l.name && l.name.toLowerCase().includes(labelName.toLowerCase())
      );
      if (closeMatches.length > 0) {
        console.warn(`[Gmail] Close matches found:`, closeMatches.map(l => `"${l.name}"`).join(", "));
      }
      
      return null;
    }
  } catch (error) {
    console.error("[Gmail] Error fetching Gmail labels:", error);
    return null;
  }
}

/**
 * Ensure a Gmail label exists (create if missing).
 * 
 * @param accessToken Google OAuth access token
 * @param labelName Label name to ensure exists
 * @returns Label ID and name
 * @throws Error if label name is invalid (e.g., INBOX or other system labels)
 */
export async function ensureLabel(
  accessToken: string,
  labelName: string
): Promise<GmailLabel> {
  // Validate label name (reject INBOX and other system labels)
  const validationError = validateLabelName(labelName);
  if (validationError) {
    throw new Error(validationError);
  }

  const gmail = createGmailClient(accessToken);

  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = (list.data.labels || []).find((l) => l.name === labelName);

  if (existing?.id) {
    return { id: existing.id, name: labelName };
  }

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  if (!created.data.id) {
    throw new Error(`Failed to create Gmail label: ${labelName}`);
  }

  console.log(`[Gmail] Created label "${labelName}" with ID: ${created.data.id}`);
  return { id: created.data.id, name: labelName };
}

/**
 * Apply a label to a Gmail message by label ID.
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @param labelId Label ID to apply
 */
export async function applyLabelById(
  accessToken: string,
  messageId: string,
  labelId: string
): Promise<void> {
  const gmail = createGmailClient(accessToken);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
  console.log(`[Gmail] Applied label ${labelId} to message ${messageId}`);
}

/**
 * Remove a label from a Gmail message by label ID.
 * 
 * @param accessToken Google OAuth access token
 * @param messageId Gmail message ID
 * @param labelId Label ID to remove
 */
export async function removeLabelById(
  accessToken: string,
  messageId: string,
  labelId: string
): Promise<void> {
  const gmail = createGmailClient(accessToken);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: [labelId] },
  });
  console.log(`[Gmail] Removed label ${labelId} from message ${messageId}`);
}

/**
 * Remove the work orders label from a Gmail message (legacy function).
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

    await removeLabelById(accessToken, messageId, labelId);
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
 * Result type for paginated email listing.
 */
export type ListWorkOrderEmailsResult = {
  emails: GmailFoundEmail[];
  nextPageToken: string | null;
};

/**
 * List recent emails with PDF attachments (likely work orders).
 * 
 * @param accessToken Google OAuth access token
 * @param labelName Optional Gmail label name to filter by (e.g., "Work Orders", "signed WO", "Signed/WO")
 * @param labelId Optional pre-resolved label ID (if provided, labelName is ignored for lookup)
 * @param pageToken Optional page token for pagination
 * @param maxResults Maximum number of results per page (default: 50)
 * @returns Array of email metadata with PDF attachment counts and next page token
 * 
 * Note: Only returns emails that have PDF attachments. Labels are matched case-insensitively.
 */
export async function listWorkOrderEmails(
  accessToken: string,
  labelName?: string,
  labelId?: string | null,
  pageToken?: string,
  maxResults: number = 50
): Promise<ListWorkOrderEmailsResult> {
  const gmail = createGmailClient(accessToken);

  // IMPORTANT FILTERING RULES:
  // - ✅ Filter by: label (labelToUse) and PDF attachments
  // - ❌ Does NOT filter by subject line - emails with any subject are included
  // - ❌ Does NOT filter by sender/from address - emails from anyone are included
  // - ❌ Does NOT filter by recipient - emails to anyone are included
  // Only the label and PDF attachment requirement matter.
  
  const baseQ = "has:attachment filename:pdf";

  // If labelId exists, DON'T put label name in the query at all.
  // If labelId doesn't exist but labelName does, quote it.
  const q = labelId
    ? baseQ
    : labelName
      ? `label:"${labelName.replace(/"/g, '\\"')}" ${baseQ}`
      : baseQ;

  // Step 4: Debug logging
  console.log(`[Gmail List] Debug info:`);
  console.log(`[Gmail List]   - labelName: "${labelName || 'none'}"`);
  console.log(`[Gmail List]   - labelId: ${labelId || 'none'}`);
  console.log(`[Gmail List]   - query: "${q}"`);
  console.log(`[Gmail List]   - labelIds: ${labelId ? labelId : 'none'}`);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q,
    labelIds: labelId ? [labelId] : undefined,
    pageToken,
    maxResults,
    includeSpamTrash: false,
  });

  const messageIds = (listRes.data.messages || []).map((m: any) => m.id).filter(Boolean);
  console.log(`[Gmail List] Found ${messageIds.length} message IDs from Gmail API`);

  if (messageIds.length === 0) {
    console.log(`[Gmail List] No messages found in label "${labelName || 'none'}"`);
    return {
      emails: [],
      nextPageToken: listRes.data.nextPageToken || null,
    };
  }

  // Fetch detailed metadata for each message
  // Use "full" format to get complete message structure for PDF detection
  const detailed = await Promise.all(
    messageIds.map(async (messageId: string) => {
      try {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
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
         * Gmail message part structure
         */
        type GmailMessagePart = {
          mimeType?: string;
          filename?: string;
          body?: {
            attachmentId?: string;
            data?: string;
            size?: number;
          };
          parts?: GmailMessagePart[];
        };

        /**
         * Recursively traverse message parts to find PDF attachments.
         * Gmail messages can have nested multipart structures.
         */
        function countPdfParts(parts: GmailMessagePart[]): void {
          if (!parts || !Array.isArray(parts)) return;
          
          parts.forEach((p) => {
            if (!p) return;
            
            const mimeType = (p.mimeType ?? "").toLowerCase();
            const filename = (p.filename ?? "").toLowerCase();
            const body = p.body ?? {};
            
            // Step 3: Check if this part is a PDF - ONLY count PDFs
            // filename ends with .pdf OR mimeType === "application/pdf"
            const isPdf = 
              filename.endsWith(".pdf") ||
              mimeType === "application/pdf";
            
            // PDF attachments have an attachmentId in the body (only count actual attachments)
            if (isPdf && body.attachmentId) {
              attachmentCount += 1;
            }
            
            // Recursively check nested parts (multipart messages)
            if (p.parts && Array.isArray(p.parts) && p.parts.length > 0) {
              countPdfParts(p.parts);
            }
          });
        }

        // Step 3: Start traversal from root payload
        if (payload) {
          // If payload itself is a PDF (rare but possible)
          const rootMimeType = (payload.mimeType ?? "").toLowerCase();
          const rootFilename = (payload.filename ?? "").toLowerCase();
          // Step 3: Only count if it's a PDF AND has attachmentId
          if (
            (rootMimeType === "application/pdf" || rootFilename.endsWith(".pdf")) &&
            payload.body?.attachmentId
          ) {
            attachmentCount += 1;
          }
          
          // Traverse parts recursively (critical for nested structures)
          if (payload.parts && Array.isArray(payload.parts)) {
            countPdfParts(payload.parts);
          }
        }

        return {
          id: messageId,
          threadId: full.data.threadId ?? null,
          from,
          subject,
          date,
          snippet,
          attachmentCount,
        };
      } catch (error) {
        console.error(`Error fetching message ${messageId}:`, error);
        // Return minimal info if we can't fetch the full message
        return {
          id: messageId,
          threadId: null,
          from: "",
          subject: "",
          date: "",
          snippet: "",
          attachmentCount: 0,
        };
      }
    })
  );

  // Step 3: Filter to only return emails with PDF attachments
  const emailsWithPdfs = detailed.filter(e => e.attachmentCount > 0);
  const totalPdfAttachments = detailed.reduce((sum, e) => sum + e.attachmentCount, 0);
  
  // Step 4: Debug logging
  console.log(`[Gmail List] Summary for label "${labelName || 'INBOX'}":`);
  console.log(`[Gmail List]   - Total messages fetched: ${detailed.length}`);
  console.log(`[Gmail List]   - Emails with PDF attachments: ${emailsWithPdfs.length}`);
  console.log(`[Gmail List]   - Total PDF attachments: ${totalPdfAttachments}`);
  
  // Step 3: Only return emails that have PDF attachments
  return {
    emails: emailsWithPdfs, // Changed: only return emails with PDFs
    nextPageToken: listRes.data.nextPageToken || null,
  };
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
   * Gmail message part structure
   */
  type GmailMessagePart = {
    mimeType?: string;
    filename?: string;
    body?: {
      attachmentId?: string;
      data?: string;
      size?: number;
    };
    parts?: GmailMessagePart[];
  };

  /**
   * Recursively collect PDF attachments from message parts.
   */
  async function collectParts(parts: GmailMessagePart[]): Promise<void> {
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

