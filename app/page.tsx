/**
 * Root page - redirects based on onboarding status.
 * 
 * For new users (no onboarding): redirect to /onboarding
 * For users with workspace: redirect to /pro
 */

import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/workspace/loadWorkspace";
import { readWorkspaceCookies } from "@/lib/workspace/workspaceCookies";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/currentUser";

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const user = await getCurrentUser();
  
  // If not authenticated, redirect to sign-in
  if (!user || !user.userId) {
    redirect("/auth/signin");
  }

  const cookieStore = await cookies();
  const wsCookies = readWorkspaceCookies(cookieStore);
  
  // Check if onboarding is completed
  const onboardingCompleted = wsCookies.onboardingCompleted === "true";
  const workspaceReady = wsCookies.workspaceReady === "true";
  const hasRequiredFields = wsCookies.spreadsheetId && wsCookies.folderId;
  
  // If onboarding is completed, redirect to /pro
  if (onboardingCompleted || (workspaceReady && hasRequiredFields)) {
    // Try to load workspace to verify it's actually available
    const workspace = await loadWorkspace();
    if (workspace) {
      redirect("/pro");
    }
    // If workspace can't be loaded but cookies say ready, still redirect to /pro
    // The /pro page will handle the case gracefully
    if (workspaceReady && hasRequiredFields) {
      redirect("/pro");
    }
  }
  
  // New user or incomplete onboarding - redirect to onboarding
  redirect("/onboarding");
}
