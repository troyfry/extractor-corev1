/**
 * API route to list Gmail emails with PDF attachments from "signed_WOs" label.
 * 
 * GET /api/gmail/signed
 * 
 * Returns a list of recent emails from the "signed_WOs" label that have PDF attachments.
 * 
 * Requires authentication with Google OAuth access token.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { listWorkOrderEmails, createGmailClient, getLabelIdByName } from "@/lib/google/gmail";
import { extractPdfAttachments } from "@/lib/google/gmailExtract";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const accessToken = user.googleAccessToken;
    
    if (!accessToken) {
      return NextResponse.json(
        { 
          error: "No Google access token available. Please sign out and sign in again to grant Gmail access.",
        },
        { status: 400 }
      );
    }

    // Get optional query parameters
    const { searchParams } = new URL(request.url);
    const pageToken = searchParams.get("pageToken") || undefined;
    const maxResults = searchParams.get("maxResults") 
      ? parseInt(searchParams.get("maxResults")!, 10) 
      : 50;
    const labelParam = searchParams.get("label");

    // Use label from query param or default to "signed_WOs"
    const labelName = labelParam || "signed_WOs";
    const labelId = await getLabelIdByName(accessToken, labelName);

    if (!labelId) {
      return NextResponse.json(
        { 
          error: `Label "${labelName}" not found. Please create this label in Gmail first.`,
          emails: [],
        },
        { status: 200 } // Return empty list instead of error
      );
    }

    // List emails with PDF attachments from this label
    const result = await listWorkOrderEmails(accessToken, labelName, labelId, pageToken, maxResults);

    // Fetch detailed attachment info for each email
    const gmail = createGmailClient(accessToken);
    const emailsWithAttachments = await Promise.all(
      result.emails.map(async (email) => {
        try {
          // Get full message to extract attachment details
          const full = await gmail.users.messages.get({
            userId: "me",
            id: email.id,
            format: "full",
          });

          const payload = full.data.payload;
          const pdfAttachments = extractPdfAttachments(payload);

          return {
            messageId: email.id,
            threadId: email.threadId,
            from: email.from,
            subject: email.subject,
            date: email.date,
            snippet: email.snippet,
            attachments: pdfAttachments.map((att) => ({
              filename: att.filename,
              attachmentId: att.attachmentId,
              mimeType: att.mimeType || "application/pdf",
            })),
          };
        } catch (error) {
          console.error(`Error fetching message ${email.id}:`, error);
          return {
            messageId: email.id,
            threadId: email.threadId,
            from: email.from,
            subject: email.subject,
            date: email.date,
            snippet: email.snippet,
            attachments: [],
          };
        }
      })
    );

    // Filter to only emails with PDF attachments
    const emailsWithPdfs = emailsWithAttachments.filter((e) => e.attachments.length > 0);

    console.log(`[Gmail Signed API] Found ${emailsWithPdfs.length} email(s) with PDF attachments from label "${labelName}"`);

    return NextResponse.json(
      { 
        emails: emailsWithPdfs,
        nextPageToken: result.nextPageToken,
        labelName,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error listing signed Gmail emails:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to list Gmail emails";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
