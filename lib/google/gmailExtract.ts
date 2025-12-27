/**
 * Gmail PDF attachment extraction utilities.
 * 
 * Extracts PDF attachment references from Gmail message payloads
 * without downloading the attachments.
 */

export type PdfAttachmentRef = {
  filename: string;
  attachmentId: string;
  mimeType?: string;
  partId?: string;
};

/**
 * Gmail message part structure
 */
type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  partId?: string;
  body?: {
    attachmentId?: string;
    data?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
};

/**
 * Recursively extract PDF attachment references from Gmail message payload.
 * 
 * Only includes parts where:
 * - body?.attachmentId exists (actual attachment, not inline content)
 * - AND (mimeType === "application/pdf" OR filename endsWith ".pdf")
 * 
 * @param payload Gmail message payload (from gmail.users.messages.get)
 * @returns Array of PDF attachment references
 */
export function extractPdfAttachments(payload: any): PdfAttachmentRef[] {
  const pdfAttachments: PdfAttachmentRef[] = [];

  /**
   * Recursively walk message parts to find PDF attachments
   */
  function walkParts(parts: GmailMessagePart[], parentPartId?: string): void {
    if (!parts || !Array.isArray(parts)) return;

    for (const part of parts) {
      if (!part) continue;

      const mimeType = (part.mimeType || "").toLowerCase();
      const filename = (part.filename || "").toLowerCase();
      const body = part.body || {};
      const attachmentId = body.attachmentId;

      // Check if this part is a PDF
      const isPdf = 
        mimeType === "application/pdf" ||
        filename.endsWith(".pdf");

      // Only include if it's a PDF AND has an attachmentId (actual attachment, not inline)
      if (isPdf && attachmentId) {
        pdfAttachments.push({
          filename: part.filename || "attachment.pdf",
          attachmentId,
          mimeType: part.mimeType || "application/pdf",
          partId: parentPartId,
        });
      }

      // Recursively check nested parts (multipart messages)
      if (part.parts && Array.isArray(part.parts) && part.parts.length > 0) {
        walkParts(part.parts, part.partId || parentPartId);
      }
    }
  }

  // Start from root payload
  if (payload) {
    // Check if payload itself is a PDF attachment
    const rootMimeType = (payload.mimeType || "").toLowerCase();
    const rootFilename = (payload.filename || "").toLowerCase();
    const rootBody = payload.body || {};
    
    if (
      (rootMimeType === "application/pdf" || rootFilename.endsWith(".pdf")) &&
      rootBody.attachmentId
    ) {
      pdfAttachments.push({
        filename: payload.filename || "attachment.pdf",
        attachmentId: rootBody.attachmentId,
        mimeType: payload.mimeType || "application/pdf",
      });
    }

    // Walk through parts
    if (payload.parts && Array.isArray(payload.parts)) {
      walkParts(payload.parts);
    }
  }

  return pdfAttachments;
}

