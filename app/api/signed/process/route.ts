import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getWorkspace } from "@/lib/workspace/getWorkspace";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { processSignedPdf } from "@/lib/workOrders/signedProcessor";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      console.log("[Signed Process] No user found");
      return new Response("Unauthorized", { status: 401 });
    }

    const accessToken = user.googleAccessToken || undefined;
    if (!accessToken) {
      console.log("[Signed Process] No Google access token");
      return NextResponse.json(
        {
          error:
            "Google access token not found. Please reconnect your Google account in Settings.",
        },
        { status: 400 }
      );
    }

    // Get workspace (uses cookie module internally)
    const workspaceResult = await getWorkspace();
    if (!workspaceResult) {
      return NextResponse.json(
        { error: "Workspace not found. Please complete onboarding." },
        { status: 400 }
      );
    }

    const spreadsheetId = workspaceResult.workspace.spreadsheetId;

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      console.log("[Signed Process] No file uploaded");
      return NextResponse.json(
        { error: "No signed PDF uploaded." },
        { status: 400 }
      );
    }

    const rawFmKey = (formData.get("fmKey") as string | null)?.trim() || "";
    if (!rawFmKey) {
      console.log("[Signed Process] No fmKey provided");
      return NextResponse.json(
        { error: "fmKey is required to process signed work orders." },
        { status: 400 }
      );
    }

    const woNumberOverride =
      (formData.get("woNumber") as string | null) || null;
    const manualReason = (formData.get("reason") as string | null) || null;
    const pageOverride = formData.get("page");
    const pageNumber = pageOverride ? parseInt(String(pageOverride), 10) : null;

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);
    const originalFilename = file.name || "signed-work-order.pdf";

    // Call shared processor
    const result = await processSignedPdf({
      accessToken,
      spreadsheetId,
      fmKey: rawFmKey, // Processor will normalize internally
      pdfBuffer,
      originalFilename,
      woNumberOverride,
      manualReason,
      pageNumberOverride: pageNumber,
      source: "UPLOAD",
    });

    // Rehydrate cookies if workspace was loaded from Users Sheet
    const response = NextResponse.json(result, { status: 200 });
    if (workspaceResult.source === "users_sheet") {
      rehydrateWorkspaceCookies(response, workspaceResult.workspace);
    }

    return response;
  } catch (error) {
    console.error("Error in POST /api/signed/process", error);
    const message =
      error instanceof Error ? error.message : "Failed to process signed work order";
    return NextResponse.json(
      {
        error: "Failed to process signed work order.",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
