/**
 * Process email message endpoint.
 * 
 * POST /api/email-messages/[id]/process
 *   Response: {
 *     emailMessage: EmailMessage,
 *     createdWorkOrders: WorkOrder[],
 *     skippedAsDuplicate: boolean,
 *     duplicateWorkOrderNumbers: string[]
 *   }
 * 
 * This endpoint processes an email message by:
 * - Extracting work order numbers from attachments/subject
 * - Checking for duplicates (scoped to user)
 * - Creating WorkOrder records for non-duplicates
 * - Updating email processing status
 * 
 * Requires authentication - work orders are scoped to the authenticated user.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { processSingleEmailMessage } from "@/lib/workOrders/processing";

// Ensure this route runs in Node.js runtime (not Edge) for pdf-parse compatibility
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Require authentication
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = user.userId;

  try {
    const result = await processSingleEmailMessage(id, userId);

    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        emailMessage: result.email,
        createdWorkOrders: result.createdWorkOrders,
        skippedAsDuplicate: result.skippedAsDuplicate,
        duplicateWorkOrderNumbers: result.duplicateWorkOrderNumbers,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in POST /api/email-messages/[id]/process", err);
    const errorMessage = err instanceof Error ? err.message : "Server error";
    const errorStack = err instanceof Error ? err.stack : undefined;
    console.error("Error details:", { errorMessage, errorStack, emailId: id });
    return NextResponse.json(
      { 
        error: errorMessage,
        // Include stack trace in development only
        ...(process.env.NODE_ENV === "development" && errorStack ? { stack: errorStack } : {})
      },
      { status: 500 }
    );
  }
}

