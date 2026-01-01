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
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import ProHomePageClient from "./ProHomePageClient";

// Mark this route as dynamic since it uses cookies()
export const dynamic = 'force-dynamic';

export default async function ProHomePage() {
  // Load workspace (cookie-first, then Users Sheet)
  const workspace = await loadWorkspace();

  // If workspace loaded from Users Sheet, set cookies for next request
  if (workspace) {
    const cookieStore = await cookies();
    const workspaceReady = cookieStore.get("workspaceReady")?.value;
    
    // If workspace was loaded from Sheets, rehydrate cookies
    if (workspaceReady !== "true") {
      // This is a server component, so we can't set cookies directly
      // Cookies will be set by the bootstrap endpoint or on next API call
      // For now, we'll let the client call bootstrap if needed
    }
  }

  // If no workspace found, redirect to onboarding
  if (!workspace) {
    console.log("[Pro Page] No workspace found - redirecting to onboarding");
    redirect("/onboarding");
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
