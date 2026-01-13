// app/api/db/workspace/read-source/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/auth";
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getPrimaryReadSource, setPrimaryReadSource } from "@/lib/db/services/workspace";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 400 }
      );
    }

    const source = await getPrimaryReadSource(workspaceId);
    return NextResponse.json({ primaryReadSource: source });
  } catch (error) {
    console.error("[DB Workspace Read Source API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { primaryReadSource } = body;

    if (primaryReadSource !== "LEGACY" && primaryReadSource !== "DB") {
      return NextResponse.json(
        { error: "Invalid primaryReadSource. Must be 'LEGACY' or 'DB'" },
        { status: 400 }
      );
    }

    // TODO: Add admin permission check here if needed
    // For now, allow workspace owners to change this setting

    await setPrimaryReadSource(workspaceId, primaryReadSource);

    return NextResponse.json({ success: true, primaryReadSource });
  } catch (error) {
    console.error("[DB Workspace Read Source API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
