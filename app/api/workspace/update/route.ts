/**
 * API route to update workspace configuration (Gmail labels, etc.).
 * 
 * POST /api/workspace/update
 * Body: { gmailWorkOrdersLabelName?, gmailSignedLabelName?, gmailProcessedLabelName? }
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { saveWorkspaceConfig } from "@/lib/workspace/saveWorkspace";
import { rehydrateWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { ensureLabel } from "@/lib/google/gmail";
import { validateLabelName } from "@/lib/google/gmailValidation";
import {
  WORK_ORDERS_LABEL_NAME,
  SIGNED_WORK_ORDERS_LABEL_NAME,
  PROCESSED_WORK_ORDERS_LABEL_NAME,
} from "@/lib/google/gmailConfig";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.userId || !user.googleAccessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load existing workspace
    const existingWorkspace = await loadWorkspace();
    if (!existingWorkspace) {
      return NextResponse.json(
        { error: "Workspace not found. Please complete onboarding first." },
        { status: 400 }
      );
    }

    // Get label names from request body
    const body = await request.json().catch(() => ({}));
    const gmailWorkOrdersLabelName =
      body.gmailWorkOrdersLabelName || existingWorkspace.gmailWorkOrdersLabelName || WORK_ORDERS_LABEL_NAME;
    const gmailSignedLabelName =
      body.gmailSignedLabelName || existingWorkspace.gmailSignedLabelName || SIGNED_WORK_ORDERS_LABEL_NAME;
    const gmailProcessedLabelName =
      body.gmailProcessedLabelName !== undefined
        ? (body.gmailProcessedLabelName || null)
        : (existingWorkspace.gmailProcessedLabelName || PROCESSED_WORK_ORDERS_LABEL_NAME);

    // Validate label names
    const workOrdersError = validateLabelName(gmailWorkOrdersLabelName);
    if (workOrdersError) {
      return NextResponse.json(
        { error: `Work Orders Label: ${workOrdersError}` },
        { status: 400 }
      );
    }

    const signedError = validateLabelName(gmailSignedLabelName);
    if (signedError) {
      return NextResponse.json(
        { error: `Signed Label: ${signedError}` },
        { status: 400 }
      );
    }

    if (gmailProcessedLabelName) {
      const processedError = validateLabelName(gmailProcessedLabelName);
      if (processedError) {
        return NextResponse.json(
          { error: `Processed Label: ${processedError}` },
          { status: 400 }
        );
      }
    }

    // Create/ensure labels exist in Gmail
    const woLabel = await ensureLabel(user.googleAccessToken, gmailWorkOrdersLabelName);
    const signedLabel = await ensureLabel(user.googleAccessToken, gmailSignedLabelName);
    const processedLabel = gmailProcessedLabelName
      ? await ensureLabel(user.googleAccessToken, gmailProcessedLabelName)
      : { id: null, name: null };

    // Update workspace config
    const updatedWorkspace = {
      ...existingWorkspace,
      gmailWorkOrdersLabelName: woLabel.name,
      gmailWorkOrdersLabelId: woLabel.id,
      gmailSignedLabelName: signedLabel.name,
      gmailSignedLabelId: signedLabel.id,
      gmailProcessedLabelName: processedLabel.name || null,
      gmailProcessedLabelId: processedLabel.id || null,
    };

    await saveWorkspaceConfig(user.userId, updatedWorkspace);

    // Rehydrate cookies with updated values
    const response = NextResponse.json({ success: true, workspace: updatedWorkspace });
    rehydrateWorkspaceCookies(response, updatedWorkspace);

    return response;
  } catch (error) {
    console.error("[Workspace Update API] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to update workspace";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

