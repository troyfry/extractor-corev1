import React from "react";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import AppShell from "@/components/layout/AppShell";
import WorkOrdersList from "@/components/work-orders/WorkOrdersList";
import { getWorkspace } from "@/lib/workspace/getWorkspace";
import { cookies } from "next/headers";
import { readWorkspaceCookies } from "@/lib/workspace/workspaceCookies";

export default async function WorkOrdersPage() {
  // Require authentication
  const user = await getCurrentUser();
  if (!user) {
    redirect(ROUTES.signIn);
  }

  // Check if workspace is configured
  const workspace = await getWorkspace();
  
  if (!workspace) {
    // Check cookies to see if workspace was ever configured
    const cookieStore = await cookies();
    const wsCookies = readWorkspaceCookies(cookieStore);
    
    // DB-native: Check for workspaceId cookie (doesn't require spreadsheetId)
    // Legacy: Check for spreadsheetId cookie
    const isWorkspaceReady = wsCookies.workspaceReady === "true" && 
                            (wsCookies.workspaceId || wsCookies.spreadsheetId);
    
    if (!isWorkspaceReady) {
      console.log("[Work Orders Page] No workspace found - redirecting to onboarding", {
        workspaceReady: wsCookies.workspaceReady,
        hasWorkspaceId: !!wsCookies.workspaceId,
        hasSpreadsheetId: !!wsCookies.spreadsheetId,
      });
      redirect(ROUTES.onboarding);
    }
    
    // Cookie says ready but workspace couldn't be loaded - might be temporary
    // Allow access and let client handle gracefully
    console.log("[Work Orders Page] Cookie says workspaceReady but getWorkspace() returned null - allowing access (might be temporary)");
  }

  return (
    <AppShell>
      <WorkOrdersList />
    </AppShell>
  );
}
