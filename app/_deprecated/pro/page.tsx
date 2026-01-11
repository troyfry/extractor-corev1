/**
 * Pro Home Page - Server Component Wrapper
 * 
 * Uses universal workspace loader to check workspace status.
 * Never redirects to onboarding unless workspace is truly missing.
 * 
 * Priority:
 * 1. Cookies (fast, zero API calls)
 * 2. Users Sheet (source of truth, rehydrates cookies)
 * 3. Redirect to onboarding only if BOTH are missing
 */

import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { readWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { cookies } from "next/headers";
import ProHomePageClient from "./ProHomePageClient";

// Mark this route as dynamic since it uses cookies()
export const dynamic = 'force-dynamic';

export default async function ProHomePage() {
  const cookieStore = await cookies();
  
  // Load workspace (cookie-first, then Users Sheet)
  const workspace = await loadWorkspace();

  // If workspace loaded from Users Sheet, set cookies for next request
  if (workspace) {
    const workspaceReady = cookieStore.get("workspaceReady")?.value;
    
    // If workspace was loaded from Sheets, rehydrate cookies
    if (workspaceReady !== "true") {
      // This is a server component, so we can't set cookies directly
      // Cookies will be set by the bootstrap endpoint or on next API call
      // For now, we'll let the client call bootstrap if needed
    }
  }

  // If no workspace found, check if workspace is actually ready
  if (!workspace) {
    const wsCookies = readWorkspaceCookies(cookieStore);
    
    // Check if workspace cookie says ready AND has required fields
    // If cookie says ready but missing required fields, workspace isn't actually ready
    const hasRequiredFields = wsCookies.spreadsheetId && wsCookies.folderId;
    const isWorkspaceReady = wsCookies.workspaceReady === "true" && hasRequiredFields;
    
    if (!isWorkspaceReady) {
      // Workspace is not ready - redirect to onboarding
      console.log("[Pro Page] No workspace found - redirecting to onboarding", {
        workspaceReady: wsCookies.workspaceReady,
        hasSpreadsheetId: !!wsCookies.spreadsheetId,
        hasFolderId: !!wsCookies.folderId,
      });
      redirect("/onboarding");
    }
    
    // Cookie says ready and has required fields, but loadWorkspace() returned null
    // This might be a temporary issue (quota error, etc.) - allow access
    // Client-side code can handle this gracefully
    console.log("[Pro Page] Cookie says workspaceReady with required fields but loadWorkspace() returned null - allowing access (might be temporary)");
  }

  // Check for degraded status cookie (quota error)
  try {
    const cookieStore = await cookies();
    const degraded = cookieStore.get("onboardingStatusDegraded")?.value;
    
    if (degraded === "true") {
      console.log("[Pro Page] Status degraded - rendering with error message");
      return <ProHomePageClient quotaError={true} />;
    }
  } catch (error) {
    // Continue if cookie check fails
  }

  // Workspace exists - render pro page
  return <ProHomePageClient />;
}
