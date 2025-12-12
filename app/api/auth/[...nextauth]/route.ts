/**
 * NextAuth API route handler for App Router.
 * 
 * This file handles all authentication routes:
 * - GET/POST /api/auth/signin
 * - GET/POST /api/auth/signout
 * - GET /api/auth/session
 * - GET /api/auth/providers
 * - etc.
 * 
 * Uses the handlers exported from auth.ts.
 */

import { handlers } from "@/auth";
import { NextResponse } from "next/server";

// Wrap handlers with error handling
async function handleRequest(
  req: Request,
  handler: (req: Request) => Promise<Response>
): Promise<Response> {
  try {
    return await handler(req);
  } catch (error) {
    console.error("[Auth API] Error:", error);
    return NextResponse.json(
      { 
        error: "Authentication service error",
        message: process.env.NODE_ENV === "development" 
          ? (error instanceof Error ? error.message : String(error))
          : "Please check your environment variables (AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)"
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  if (!handlers.GET) {
    return NextResponse.json({ error: "Auth handlers not configured" }, { status: 500 });
  }
  return handleRequest(req, handlers.GET);
}

export async function POST(req: Request) {
  if (!handlers.POST) {
    return NextResponse.json({ error: "Auth handlers not configured" }, { status: 500 });
  }
  return handleRequest(req, handlers.POST);
}

