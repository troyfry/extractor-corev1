/**
 * API route for validating OpenAI API key (optional, no longer part of onboarding flow).
 * 
 * POST /api/onboarding/openai
 * Body: { openaiKey: string }
 * 
 * DEPRECATED: OpenAI setup is now optional and handled via Settings page.
 * This route is kept for backward compatibility and validation only.
 * Keys are NOT stored in Sheets/DB - they are client-side only (sessionStorage).
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import OpenAI from "openai";

export const runtime = "nodejs";

/**
 * Validate OpenAI API key by making a small test call.
 */
async function validateOpenAIKey(key: string): Promise<boolean> {
  try {
    const client = new OpenAI({ apiKey: key });
    // Make a minimal test call (list models is lightweight)
    await client.models.list();
    return true;
  } catch (error) {
    console.error("OpenAI key validation failed:", error);
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.googleAccessToken) {
      return NextResponse.json(
        { error: "Google OAuth token not available. Please sign in again." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { openaiKey } = body;

    if (!openaiKey || typeof openaiKey !== "string") {
      return NextResponse.json(
        { error: "openaiKey is required" },
        { status: 400 }
      );
    }

    // Basic validation: check if it starts with "sk-"
    if (!openaiKey.startsWith("sk-")) {
      return NextResponse.json(
        { error: "Invalid OpenAI API key format. Keys should start with 'sk-'" },
        { status: 400 }
      );
    }

    // Validate the key with OpenAI
    const isValid = await validateOpenAIKey(openaiKey);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid OpenAI API key. Please check your key and try again." },
        { status: 400 }
      );
    }

    // NOTE: Keys are no longer stored in Sheets/DB - they are client-side only
    // This route now only validates the key and returns success
    // The client should store the key in sessionStorage using the BYOK helpers
    
    // Return success (key validation already done above)
    return NextResponse.json({ 
      success: true,
      message: "OpenAI key validated successfully. Store it in sessionStorage on the client side."
    });
  } catch (error) {
    console.error("Error saving OpenAI key:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

