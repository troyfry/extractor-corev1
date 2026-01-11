/**
 * Email messages listing API.
 * 
 * GET /api/email-messages?limit=50&cursor=2024-01-01T00:00:00Z
 *   Response: { emailMessages: EmailMessage[], hasMore: boolean }
 */
import { NextResponse } from "next/server";
import { emailMessageRepo } from "@/lib/emailMessages/repository";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const cursorParam = searchParams.get("cursor");
    const statusFilter = searchParams.get("status"); // Optional: filter by status

    let messages;
    let hasMore = false;

    // If status filter is "new", use listNew method (more efficient)
    if (statusFilter === "new" && !cursorParam) {
      messages = await emailMessageRepo.listNew(limit + 1);
      if (messages.length > limit) {
        hasMore = true;
        messages = messages.slice(0, limit);
      }
    } else if (cursorParam) {
      // Pagination: get emails after cursor
      const cursor = new Date(cursorParam);
      messages = await emailMessageRepo.listLatestAfter(cursor, limit + 1);
      
      // Apply status filter if provided
      if (statusFilter) {
        messages = messages.filter((msg) => msg.processingStatus === statusFilter);
      }
      
      // Check if there are more emails
      if (messages.length > limit) {
        hasMore = true;
        messages = messages.slice(0, limit);
      }
    } else {
      // Initial load: get latest emails
      messages = await emailMessageRepo.listLatest(limit + 1);
      
      // Apply status filter if provided (default to "new" if not specified)
      const filterStatus = statusFilter || "new";
      messages = messages.filter((msg) => msg.processingStatus === filterStatus);
      
      // Check if there are more emails
      if (messages.length > limit) {
        hasMore = true;
        messages = messages.slice(0, limit);
      }
    }

    return NextResponse.json(
      { emailMessages: messages, hasMore },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in GET /api/email-messages", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/email-messages
 * Clear all email messages (useful for testing/reset).
 */
export async function DELETE() {
  try {
    await emailMessageRepo.clear();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error clearing email messages:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

