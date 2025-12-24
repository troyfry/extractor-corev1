/**
 * API route for saving OpenAI API key during onboarding.
 * 
 * POST /api/onboarding/openai
 * Body: { openaiKey: string }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserRowById, upsertUserRow, ensureUsersSheet } from "@/lib/onboarding/usersSheet";
import { encryptSecret } from "@/lib/onboarding/crypto";
import { cookies } from "next/headers";
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

    // Encrypt the key
    const encryptedKey = encryptSecret(openaiKey);

    // Get the main spreadsheet ID from cookie (set during Google step)
    const cookieStore = await cookies();
    const mainSpreadsheetId = cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    if (!mainSpreadsheetId) {
      return NextResponse.json(
        { error: "Spreadsheet ID not configured. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Ensure Users sheet exists (onboarding route - must ensure sheet exists)
    await ensureUsersSheet(user.googleAccessToken, mainSpreadsheetId);

    // Get existing user row
    const userRow = await getUserRowById(user.googleAccessToken, mainSpreadsheetId, user.userId);
    if (!userRow) {
      return NextResponse.json(
        { error: "User row not found. Please complete the Google step first." },
        { status: 400 }
      );
    }

    // Update user row with encrypted OpenAI key
    await upsertUserRow(user.googleAccessToken, mainSpreadsheetId, {
      ...userRow,
      openaiKeyEncrypted: encryptedKey,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving OpenAI key:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

