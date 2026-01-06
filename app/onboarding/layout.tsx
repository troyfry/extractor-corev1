/**
 * Layout for onboarding pages.
 * 
 * Implements resume logic: determines the correct next step from cookies and redirects if needed.
 * This prevents "random route access" from causing loops.
 * 
 * Resume rules:
 * - If onboardingCompleted=true → redirect to /pro
 * - Else if no workspaceReady → allow /onboarding/google (correct step)
 * - Else → onboarding is complete (FM Profiles and Templates are settings, not onboarding)
 * 
 * NOTE: OpenAI setup is now optional and skipped in onboarding flow.
 * NOTE: FM Profiles and Templates are settings, not onboarding steps.
 * NOTE: Uses lightweight checks (cookie-only) to avoid Sheets API quota issues.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { cookies } from "next/headers";
import { OnboardingHeader } from "@/app/components/onboarding/OnboardingHeader";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Lightweight check: only check cookies (no Sheets API calls)
  const user = await getCurrentUser();
  
  if (!user || !user.userId) {
    // Not authenticated, allow access (middleware will handle auth redirect)
    return <>{children}</>;
  }

  const cookieStore = await cookies();
  
  // Resume logic: decide next step from cookies
  const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
  const cookieWorkspaceReady = cookieStore.get("workspaceReady")?.value;
  
  // Rule 1: Full onboarding completed → redirect to /pro
  if (cookieOnboardingCompleted === "true") {
    redirect("/pro");
  }
  
  // Rule 2: No workspace → go to /onboarding/google (allow rendering - user might be on correct step)
  if (!cookieWorkspaceReady || cookieWorkspaceReady !== "true") {
    // Allow pages to render - if user is on wrong step, they'll be redirected by page logic
    // or they're on /onboarding/google which is correct
  }
  // Rule 3: Workspace ready but onboarding not complete
  // DO NOT redirect to /pro here - let the user complete onboarding
  // The /pro page will handle checking if workspace is actually loadable
  // This prevents redirect loops when workspace cookie exists but loadWorkspace() fails

  // Allow onboarding pages to render (if we get here, user is on the correct step or will be redirected)
  return (
    <>
      <OnboardingHeader />
      {children}
    </>
  );
}
