import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";

export const runtime = "nodejs";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });

  // Clear onboarding cookies
  const cookieNames = [
    "onboardingCompleted",
    "workspaceReady",
    "openaiReady",
    "fmProfilesReady",
    "googleSheetsSpreadsheetId",
    "googleDriveFolderId",
  ];

  for (const name of cookieNames) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0, // delete
      path: "/", // important: ensure deletion matches original scope
    });
  }

  return response;
}

