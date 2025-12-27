/**
 * API route to list Gmail emails with PDF attachments.
 * 
 * GET /api/gmail/list
 * 
 * Returns a list of recent emails that have PDF attachments (likely work orders).
 * 
 * Requires authentication with Google OAuth access token.
 * Stateless - does not write to database.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { listWorkOrderEmails, createGmailClient } from "@/lib/google/gmail";

export const runtime = "nodejs";

/**
 * Resolve label name to labelId (case-insensitive).
 * Handles labels with spaces and nested labels (e.g., "Signed/WO").
 */
async function resolveLabelId(gmail: any, labelName: string): Promise<string | null> {
  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels || [];

  // Case-insensitive match - Gmail labels are not reliably case-sensitive
  const normalizedLabelName = labelName.toLowerCase();
  const found = labels.find((l: any) => (l.name || "").toLowerCase() === normalizedLabelName);
  
  if (found) {
    console.log(`[Gmail List API] Resolved label "${labelName}" to ID: ${found.id}`);
    return found.id;
  }
  
  console.warn(`[Gmail List API] Label "${labelName}" not found. Available labels (first 20):`, 
    labels.slice(0, 20).map((l: any) => l.name).filter(Boolean).join(", "));
  return null;
}

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
    const labelName = searchParams.get("label") || undefined;
    const pageToken = searchParams.get("pageToken") || undefined;
    const maxResults = searchParams.get("maxResults") 
      ? parseInt(searchParams.get("maxResults")!, 10) 
      : 50; // Increased default to match Step 2

    // Step 1: Resolve label name to labelId (case-insensitive, handles spaces and nested labels)
    let labelId: string | null = null;
    if (labelName) {
      const gmail = createGmailClient(accessToken);
      labelId = await resolveLabelId(gmail, labelName);
      console.log(`[Gmail List API] Label name: "${labelName}", resolved labelId: ${labelId || "null"}`);
    }

    const result = await listWorkOrderEmails(accessToken, labelName, labelId, pageToken, maxResults);

    // Step 4: Debug logging - result already filtered to only PDFs
    const totalPdfAttachments = result.emails.reduce((sum, e) => sum + e.attachmentCount, 0);
    
    console.log(`[Gmail List API] Summary for label "${labelName || 'INBOX'}":`);
    console.log(`[Gmail List API]   - Emails with PDF attachments: ${result.emails.length}`);
    console.log(`[Gmail List API]   - Total PDF attachments: ${totalPdfAttachments}`);
    
    if (result.nextPageToken) {
      console.log(`[Gmail List API] More emails available (nextPageToken present)`);
    }
    if (result.emails.length === 0) {
      console.warn(`[Gmail List API] No emails with PDF attachments found. Check if label "${labelName || 'INBOX'}" exists and contains emails with PDF attachments.`);
    }

    return NextResponse.json(
      { 
        emails: result.emails,
        nextPageToken: result.nextPageToken,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error listing Gmail emails:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to list Gmail emails";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

