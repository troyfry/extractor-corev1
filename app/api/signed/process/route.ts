import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
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

    // Resolve spreadsheetId using the same logic as existing Pro routes
    const cookieStore = await cookies();
    const cookieSpreadsheetId =
      cookieStore.get("googleSheetsSpreadsheetId")?.value || null;

    let spreadsheetId: string | null = null;
    if (cookieSpreadsheetId) {
      spreadsheetId = cookieSpreadsheetId;
    } else {
      const session = await auth();
      const sessionSpreadsheetId = session
        ? (session as { googleSheetsSpreadsheetId?: string }).googleSheetsSpreadsheetId
        : null;
      spreadsheetId = await getUserSpreadsheetId(
        user.userId,
        sessionSpreadsheetId
      );
    }

    if (!spreadsheetId) {
      console.log("[Signed Process] No spreadsheet ID configured");
      return NextResponse.json(
        { error: "No Google Sheets spreadsheet configured." },
        { status: 400 }
      );
    }

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

    return NextResponse.json(result, { status: 200 });
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
