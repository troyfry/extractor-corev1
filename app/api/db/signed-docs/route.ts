// app/api/db/signed-docs/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { listSignedDocs } from "@/lib/db/services/signedDocs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found. Please configure your Google Sheets spreadsheet." },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const decision = searchParams.get("decision") as "MATCHED" | "UNMATCHED" | null;
    const search = searchParams.get("q") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : undefined;
    const cursor = searchParams.get("cursor") || undefined;

    const result = await listSignedDocs(
      workspaceId,
      {
        decision: decision || undefined,
        search,
      },
      {
        limit,
        cursor,
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[DB Signed Docs API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
