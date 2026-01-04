import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workspaceRequired } from "@/lib/workspace/workspaceRequired";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { processSignedPdf } from "@/lib/workOrders/signedProcessor";
import { createGmailClient } from "@/lib/google/gmail";
import { extractPdfAttachments } from "@/lib/google/gmailExtract";

export const runtime = "nodejs";

interface GmailProcessRequest {
  fmKey: string;
  messageIds?: string[]; // If provided, process only these specific message IDs
  query?: string;
  maxMessages?: number;
  maxAttachments?: number;
  newerThanDays?: number;
  labelIds?: string[];
}

interface GmailProcessItem {
  filename: string;
  messageId: string;
  attachmentId?: string;
  status: "UPDATED" | "NEEDS_REVIEW" | "BLOCKED" | "ALREADY_PROCESSED" | "ERROR";
  woNumber?: string | null;
  reason?: string | null;
  signedPdfUrl?: string | null;
  fileHash?: string;
  filenameHint?: string | null; // Hint from filename (e.g., "23rdgroup", "superclean")
  fixHref?: string | null;
  fixAction?: string | null;
  reasonTitle?: string | null;
  reasonMessage?: string | null;
  snippetImageUrl?: string | null;
  snippetDriveUrl?: string | null;
  fmKey?: string;
}

interface GmailProcessResponse {
  ok: boolean;
  fmKey: string;
  queryUsed: string;
  scannedMessages: number;
  scannedAttachments: number;
  results: {
    updated: number;
    needsReview: number;
    blocked: number;
    alreadyProcessed: number;
    errors: number;
  };
  items: GmailProcessItem[];
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Google access token not found. Please reconnect your Google account." },
        { status: 400 }
      );
    }

    // Get workspace (centralized resolution)
    const workspaceResult = await workspaceRequired();
    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    const body: GmailProcessRequest = await req.json();
    const { fmKey, messageIds, query, maxMessages = 25, maxAttachments = 50, newerThanDays = 7, labelIds } = body;

    if (!fmKey || !fmKey.trim()) {
      return NextResponse.json(
        { error: "fmKey is required." },
        { status: 400 }
      );
    }

    // Use user-selected fmKey exactly as provided (strict mode - no auto-detection, no normalization)
    const effectiveFmKey = fmKey.trim();

    /**
     * Guess FM key hint from filename (for warning only, not used for processing).
     * This helps users catch mistakes without auto-detecting.
     */
    function guessHintFromFilename(name: string): string | null {
      const n = name.toLowerCase();
      if (n.includes("23rd")) return "23rdgroup";
      if (n.includes("superclean")) return "superclean";
      return null;
    }

    const gmail = createGmailClient(accessToken);
    let messages: Array<{ id?: string | null }> = [];
    let queryUsed = "";

    // If messageIds are provided, use those directly
    if (messageIds && messageIds.length > 0) {
      console.log("[Gmail Process] Processing specific message IDs:", {
        fmKey: effectiveFmKey,
        messageIds: messageIds.length,
      });
      messages = messageIds.map(id => ({ id }));
      queryUsed = `Selected ${messageIds.length} messages`;
    } else {
      // Otherwise, search for messages
      const defaultQuery = `newer_than:${newerThanDays}d has:attachment filename:pdf`;
      queryUsed = query || defaultQuery;

      console.log("[Gmail Process] Starting Gmail batch processing:", {
        fmKey: effectiveFmKey,
        queryUsed,
        maxMessages,
        maxAttachments,
        newerThanDays,
        labelIds,
      });

      const searchResponse = await gmail.users.messages.list({
        userId: "me",
        q: queryUsed,
        maxResults: maxMessages,
        ...(labelIds && labelIds.length > 0 ? { labelIds } : {}),
      });

      messages = searchResponse.data.messages || [];
      console.log(`[Gmail Process] Found ${messages.length} messages matching query`);
    }

    const items: GmailProcessItem[] = [];
    let scannedMessages = 0;
    let scannedAttachments = 0;
    const results = {
      updated: 0,
      needsReview: 0,
      blocked: 0,
      alreadyProcessed: 0,
      errors: 0,
    };

    // Process each message
    for (const message of messages) {
      if (!message.id) continue;
      if (scannedAttachments >= maxAttachments) {
        console.log(`[Gmail Process] Reached maxAttachments limit (${maxAttachments})`);
        break;
      }

      try {
        scannedMessages++;
        
        // Fetch full message to extract PDF attachments
        const fullMessage = await gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });

        const payload = fullMessage.data.payload;
        const headers = payload?.headers ?? [];
        
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

         const emailFrom = getHeader("From");
         const emailSubject = getHeader("Subject");
         const emailDate = getHeader("Date");
         const threadId = fullMessage.data.threadId || null;

         // Use user-selected fmKey (strict mode - no auto-detection)
         // effectiveFmKey is set once at the top of the function and used for all attachments

         // Extract PDF attachment references (without downloading yet)
         const pdfRefs = extractPdfAttachments(payload);
         console.log(`[Gmail Process] Found ${pdfRefs.length} PDF attachment(s) in message ${message.id}`);
        
        // Process each PDF attachment
         for (const pdfRef of pdfRefs) {
          if (scannedAttachments >= maxAttachments) {
            break;
          }

          scannedAttachments++;
           const filename = pdfRef.filename || `attachment-${scannedAttachments}.pdf`;

          try {
             // Warn if filename hints at a different fmKey (visibility only, no blocking)
             const hint = guessHintFromFilename(filename);
             if (hint && hint !== effectiveFmKey) {
               console.warn(`[Gmail Process] Filename hint "${hint}" does not match selected fmKey "${effectiveFmKey}". Continuing (strict mode).`);
             }

             console.log(`[Gmail Process] Processing attachment: ${filename} from message ${message.id} with fmKey: ${effectiveFmKey}`);

            // Download the PDF attachment
            const attachmentRes = await gmail.users.messages.attachments.get({
              userId: "me",
              messageId: message.id,
              id: pdfRef.attachmentId,
            });

            const data = attachmentRes.data.data || "";
            // Gmail uses URL-safe base64, convert to standard base64
            const pdfBuffer = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");

            // Call shared processor with matched fmKey and source metadata
            const processResult = await processSignedPdf({
              accessToken,
              spreadsheetId,
              fmKey: effectiveFmKey,
              pdfBuffer,
              originalFilename: filename,
              source: "GMAIL",
              sourceMeta: {
                gmailMessageId: message.id,
                gmailAttachmentId: pdfRef.attachmentId,
                gmailThreadId: threadId || undefined,
                gmailFrom: emailFrom,
                gmailSubject: emailSubject,
                gmailDate: emailDate,
              },
            });

            // Interpret status from processor response
            let status: GmailProcessItem["status"];
            if (processResult.mode === "ALREADY_PROCESSED") {
              status = "ALREADY_PROCESSED";
              results.alreadyProcessed++;
            } else if (processResult.mode === "UPDATED") {
              status = "UPDATED";
              results.updated++;
            } else if (processResult.mode === "NEEDS_REVIEW") {
              // Check if it's blocked (template issues)
              if (processResult.data.automationStatus === "BLOCKED") {
                status = "BLOCKED";
                results.blocked++;
              } else {
                status = "NEEDS_REVIEW";
                results.needsReview++;
              }
            } else {
              status = "ERROR";
              results.errors++;
            }

            items.push({
              filename,
              messageId: message.id,
              status,
              woNumber: processResult.data.woNumber,
              reason: processResult.data.reason || null,
              signedPdfUrl: processResult.data.signedPdfUrl || null,
               fileHash: processResult.data.fileHash || undefined,
               filenameHint: hint && hint !== effectiveFmKey ? hint : null, // Include hint if it doesn't match
               fixHref: processResult.data.fixHref || null,
               fixAction: processResult.data.fixAction || null,
               reasonTitle: processResult.data.reasonTitle || null,
               reasonMessage: processResult.data.reasonMessage || null,
               snippetImageUrl: processResult.data.snippetImageUrl || null,
               snippetDriveUrl: processResult.data.snippetDriveUrl || null,
               fmKey: effectiveFmKey,
            });

            console.log(`[Gmail Process] Processed ${filename}: ${status}`, {
              woNumber: processResult.data.woNumber,
              reason: processResult.data.reason,
            });
          } catch (error) {
            console.error(`[Gmail Process] Error processing attachment ${filename}:`, error);
            results.errors++;
            items.push({
              filename,
              messageId: message.id,
              status: "ERROR",
              woNumber: null,
              reason: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }
      } catch (error) {
        console.error(`[Gmail Process] Error processing message ${message.id}:`, error);
        results.errors++;
        items.push({
          filename: `message-${message.id}`,
          messageId: message.id,
          status: "ERROR",
          woNumber: null,
          reason: error instanceof Error ? error.message : "Failed to fetch message",
        });
      }
    }

    const response: GmailProcessResponse = {
      ok: true,
      fmKey: effectiveFmKey, // Return the fmKey that was used (user-selected)
      queryUsed,
      scannedMessages,
      scannedAttachments,
      results,
      items,
    };

    console.log("[Gmail Process] Batch processing complete:", {
      scannedMessages,
      scannedAttachments,
      results,
    });

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const httpResponse = NextResponse.json(response, { status: 200 });
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(httpResponse, workspaceResult.workspace);
    }
    return httpResponse;
  } catch (error) {
    console.error("Error in POST /api/signed/gmail/process", error);
    const message =
      error instanceof Error ? error.message : "Failed to process Gmail attachments";
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to process Gmail attachments.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}

