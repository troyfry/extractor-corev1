/**
 * Provider-agnostic inbound email handler.
 * 
 * This endpoint accepts webhooks from various email providers (Mailgun, SES, Postmark, etc.)
 * and normalizes them into our EmailMessage format.
 * 
 * Provider is determined by:
 * - `x-email-provider` header, OR
 * - `provider` query string, OR
 * - defaults to "test" if none is provided (for local testing).
 * 
 * Authentication:
 * Callers MUST include the header:
 *   x-inbound-secret: <INBOUND_EMAIL_SECRET>
 * 
 * POST /api/inbound-email?provider=test
 *   Headers:
 *     - x-inbound-secret: <secret>
 *     - x-email-provider: test (optional, can use query param instead)
 *   Body: Provider-specific webhook payload
 *   Response: { ok: true, id: <emailMessageId> }
 */
import { NextResponse } from "next/server";
import { emailMessageRepo } from "@/lib/emailMessages/repository";
import {
  parseTestWebhook,
  parseMailgunWebhook,
  parseSesWebhook,
  parsePostmarkWebhook,
  type RawWebhookPayload,
} from "@/lib/emailMessages/providers";

export const runtime = "nodejs";

const INBOUND_SECRET = process.env.INBOUND_EMAIL_SECRET;

export async function POST(req: Request) {
  try {
    // Check if secret is configured
    if (!INBOUND_SECRET) {
      console.error("INBOUND_EMAIL_SECRET not set");
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 }
      );
    }

    // Verify authentication
    const secretHeader = req.headers.get("x-inbound-secret");
    if (!secretHeader || secretHeader !== INBOUND_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Determine provider from header, query param, or default to "test"
    const url = new URL(req.url);
    const providerFromHeader = req.headers.get("x-email-provider");
    const providerFromQuery = url.searchParams.get("provider");
    const provider = (providerFromHeader || providerFromQuery || "test").toLowerCase();

    // Parse request body
    const body = (await req.json()) as RawWebhookPayload;

    // Route to appropriate parser based on provider
    let emailInput;
    switch (provider) {
      case "test":
        emailInput = await parseTestWebhook(body);
        break;
      case "mailgun":
        emailInput = await parseMailgunWebhook(body);
        break;
      case "ses":
        emailInput = await parseSesWebhook(body);
        break;
      case "postmark":
        emailInput = await parsePostmarkWebhook(body);
        break;
      default:
        return NextResponse.json(
          { error: `Unknown provider: ${provider}` },
          { status: 400 }
        );
    }

    // Insert into database
    const saved = await emailMessageRepo.insert(emailInput);

    return NextResponse.json({ ok: true, id: saved.id }, { status: 200 });
  } catch (err) {
    console.error("Inbound email error:", err);
    const errorMessage = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

