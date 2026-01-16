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
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { isForbiddenLabel } from "@/lib/google/gmailValidation";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getWorkspaceById } from "@/lib/db/services/workspace";

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
    const labelParam = searchParams.get("label") || undefined;
    const pageToken = searchParams.get("pageToken") || undefined;
    const maxResults = searchParams.get("maxResults") 
      ? parseInt(searchParams.get("maxResults")!, 10) 
      : 50; // Increased default to match Step 2

    // Use workspace label ID by default, or resolve from query param
    let labelId: string | null = null;
    let labelName: string | undefined = undefined;
    
    if (labelParam) {
      // Query param provided - validate and resolve it
      if (isForbiddenLabel(labelParam)) {
        return NextResponse.json(
          { error: `${labelParam} is a system label and cannot be used. Please use a custom label.` },
          { status: 400 }
        );
      }
      labelName = labelParam;
      const gmail = createGmailClient(accessToken);
      labelId = await resolveLabelId(gmail, labelName);
      console.log(`[Gmail List API] Label name from query: "${labelName}", resolved labelId: ${labelId || "null"}`);
    } else {
      // Try DB first (DB-native)
      const workspaceId = await getWorkspaceIdForUser();
      if (workspaceId) {
        const dbWorkspace = await getWorkspaceById(workspaceId);
        if (dbWorkspace?.gmail_queue_label_id) {
          labelId = dbWorkspace.gmail_queue_label_id;
          // Get label name from Gmail API
          const gmail = createGmailClient(accessToken);
          const res = await gmail.users.labels.get({ userId: "me", id: labelId });
          labelName = res.data.name || undefined;
          console.log(`[Gmail List API] Using DB workspace queue label: "${labelName}" (ID: ${labelId})`);
        }
      }
      
      // Fallback to legacy workspace loader (Sheets-based)
      if (!labelId) {
        const workspace = await loadWorkspace();
        if (workspace?.labels?.queue.id) {
          // Use workspace queue label (new structure)
          labelId = workspace.labels.queue.id;
          labelName = workspace.labels.queue.name;
          console.log(`[Gmail List API] Using workspace queue label (legacy): "${labelName}" (ID: ${labelId})`);
        } else if (workspace?.gmailWorkOrdersLabelId) {
          // Fallback to legacy label (backward compatibility)
          labelId = workspace.gmailWorkOrdersLabelId;
          labelName = workspace.gmailWorkOrdersLabelName;
          console.log(`[Gmail List API] Using workspace label (legacy): "${labelName}" (ID: ${labelId})`);
        }
      }
    }
    
    // If no label found, return error (do NOT use INBOX)
    if (!labelId) {
      return NextResponse.json(
        { 
          error: "No work order queue label configured. Please complete onboarding or configure Gmail labels in Settings.",
          emails: [],
          labelName: null,
        },
        { status: 200 } // Return 200 with empty list, not an error status
      );
    }

    const result = await listWorkOrderEmails(accessToken, labelName, labelId, pageToken, maxResults);

    // Step 4: Debug logging - result already filtered to only PDFs
    const totalPdfAttachments = result.emails.reduce((sum, e) => sum + e.attachmentCount, 0);
    
    // NOTE: Do NOT sort here - sorting is done on the client side after combining all pages
    // This ensures the entire list (across all pages) is sorted correctly by oldest date first
    // Gmail API returns messages in reverse chronological order (newest first), so we need
    // to combine all pages on the client and sort the entire combined list
    
    console.log(`[Gmail List API] Summary for label "${labelName || 'unknown'}":`);
    console.log(`[Gmail List API]   - Emails with PDF attachments: ${result.emails.length}`);
    console.log(`[Gmail List API]   - Total PDF attachments: ${totalPdfAttachments}`);
    console.log(`[Gmail List API]   - Returning unsorted (client will sort entire list)`);
    
    if (result.nextPageToken) {
      console.log(`[Gmail List API] More emails available (nextPageToken present)`);
    }
    if (result.emails.length === 0) {
      console.warn(`[Gmail List API] No emails with PDF attachments found. Check if label "${labelName || 'unknown'}" exists and contains emails with PDF attachments.`);
    }

    return NextResponse.json(
      { 
        emails: result.emails, // Return unsorted - client will sort entire combined list
        nextPageToken: result.nextPageToken,
        labelName: labelName || undefined, // Return the label name being used
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

