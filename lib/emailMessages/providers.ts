/**
 * Provider-specific parsers for inbound email webhooks.
 * 
 * Each provider has a different webhook payload format. These parsers
 * normalize provider-specific payloads into our canonical EmailMessageInput format.
 */

import crypto from "node:crypto";
import type { EmailMessageInput, EmailAttachment } from "./types";

export type RawWebhookPayload = any;

/**
 * Simple helper to generate attachment IDs.
 */
function generateAttachmentId(): string {
  return crypto.randomUUID();
}

/**
 * TEST PROVIDER
 * -------------
 * Used for local testing before choosing a real email provider.
 * 
 * Accepts a payload of the shape:
 * {
 *   "from": "sender@example.com",
 *   "to": "workorders+company@example.com",
 *   "subject": "WO #123",
 *   "receivedAt": "2025-12-06T10:00:00Z", // optional, defaults to now
 *   "id": "msg-123", // optional, generates UUID if missing
 *   "attachments": [
 *     {
 *       "filename": "123.pdf",
 *       "mimeType": "application/pdf",
 *       "sizeBytes": 12345,
 *       "storageLocation": "C:/path/to/123.pdf" // or "https://..."
 *     }
 *   ]
 * }
 */
export async function parseTestWebhook(body: RawWebhookPayload): Promise<EmailMessageInput> {
  const now = new Date().toISOString();

  const attachments: EmailAttachment[] = (body.attachments || []).map(
    (att: any) => ({
      id: att.id || generateAttachmentId(),
      filename: String(att.filename ?? "attachment"),
      mimeType: String(att.mimeType ?? "application/octet-stream"),
      sizeBytes:
        typeof att.sizeBytes === "number" ? att.sizeBytes : null,
      storageLocation: att.storageLocation ?? null,
    })
  );

  return {
    provider: "test",
    providerMessageId: body.id || crypto.randomUUID(),
    fromAddress: String(body.from ?? "unknown@example.com"),
    toAddress: String(body.to ?? "unknown@example.com"),
    subject: String(body.subject ?? "(no subject)"),
    receivedAt: String(body.receivedAt ?? now),
    status: "new",
    attachments,
  };
}

/**
 * MAILGUN PROVIDER
 * ----------------
 * TODO: Implement Mailgun webhook parser.
 * 
 * Mailgun sends webhooks as form-encoded or JSON payloads with fields like:
 * - sender (from address)
 * - recipient (to address)
 * - subject
 * - timestamp (Unix timestamp)
 * - message-url (URL to retrieve full message)
 * - attachment-count
 * - attachment-X (for each attachment)
 * 
 * Implementation should:
 * 1. Accept Mailgun's form-encoded or JSON payload
 * 2. Map sender -> fromAddress
 * 3. Map recipient -> toAddress
 * 4. Map subject -> subject
 * 5. Convert timestamp to ISO string for receivedAt
 * 6. Extract attachments (may need to fetch from message-url)
 * 7. Return EmailMessageInput with provider: "mailgun"
 */
export async function parseMailgunWebhook(body: RawWebhookPayload): Promise<EmailMessageInput> {
  throw new Error("parseMailgunWebhook not implemented yet");
}

/**
 * AWS SES PROVIDER
 * ----------------
 * TODO: Implement AWS SES webhook parser.
 * 
 * SES can send notifications via SNS or directly via webhook. Common fields:
 * - mail.source (from address)
 * - mail.destination (to addresses array)
 * - mail.commonHeaders.subject
 * - mail.timestamp
 * - mail.messageId
 * - Receipt (contains action details)
 * 
 * Implementation should:
 * 1. Accept SES SNS notification or direct webhook payload
 * 2. Extract mail metadata
 * 3. Handle attachment extraction (may require S3 bucket access)
 * 4. Map to EmailMessageInput with provider: "ses"
 */
export async function parseSesWebhook(body: RawWebhookPayload): Promise<EmailMessageInput> {
  throw new Error("parseSesWebhook not implemented yet");
}

/**
 * POSTMARK PROVIDER
 * -----------------
 * TODO: Implement Postmark webhook parser.
 * 
 * Postmark sends inbound webhooks with fields like:
 * - From (from address)
 * - To (to address)
 * - Subject
 * - Date (RFC 2822 date string)
 * - MessageID
 * - Attachments (array of attachment objects)
 * 
 * Implementation should:
 * 1. Accept Postmark's JSON webhook payload
 * 2. Map Postmark fields to EmailMessageInput
 * 3. Extract attachments from Attachments array
 * 4. Convert Date to ISO string
 * 5. Return EmailMessageInput with provider: "postmark"
 */
export async function parsePostmarkWebhook(body: RawWebhookPayload): Promise<EmailMessageInput> {
  throw new Error("parsePostmarkWebhook not implemented yet");
}

