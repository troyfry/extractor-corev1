/**
 * Debug endpoint for testing PDF text extraction.
 * 
 * GET /api/debug/email-attachments/[emailId]/[attachmentId]/text
 *   Response: { filename: string, text: string }
 */
import { NextResponse } from "next/server";
import { emailMessageRepo } from "@/lib/emailMessages/repository";
import type { EmailAttachment } from "@/lib/emailMessages/types";
import { getPdfTextFromAttachmentForDebug } from "@/lib/workOrders/aiParser";

// Ensure this route runs in Node.js runtime (not Edge) for pdf-parse compatibility
export const runtime = "nodejs";

type Params = { params: Promise<{ emailId: string; attachmentId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { emailId, attachmentId } = await params;

  try {
    const email = await emailMessageRepo.getById(emailId);
    
    if (!email) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    const attachment = (email.attachments as EmailAttachment[]).find(
      (a) => a.id === attachmentId
    );
    
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const text = await getPdfTextFromAttachmentForDebug(attachment);

    return NextResponse.json(
      {
        filename: attachment.filename,
        storageLocation: attachment.storageLocation,
        text,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error in GET /api/debug/email-attachments/.../text", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}

