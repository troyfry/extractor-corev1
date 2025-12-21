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
import { listWorkOrderEmails } from "@/lib/google/gmail";

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
    const label = searchParams.get("label") || undefined;
    const pageToken = searchParams.get("pageToken") || undefined;
    const maxResults = searchParams.get("maxResults") 
      ? parseInt(searchParams.get("maxResults")!, 10) 
      : 20;

    const result = await listWorkOrderEmails(accessToken, label, pageToken, maxResults);

    // Log for debugging
    console.log(`Found ${result.emails.length} emails with attachments`);
    const emailsWithPdfs = result.emails.filter(e => e.attachmentCount > 0);
    console.log(`Found ${emailsWithPdfs.length} emails with PDF attachments`);
    if (result.nextPageToken) {
      console.log(`More emails available (nextPageToken present)`);
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

