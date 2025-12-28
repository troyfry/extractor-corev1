/**
 * Layout for onboarding pages.
 * 
 * Implements resume logic: determines the correct next step from cookies and redirects if needed.
 * This prevents "random route access" from causing loops.
 * 
 * Resume rules:
 * - If onboardingCompleted=true → redirect to /pro
 * - Else if no workspaceReady → allow /onboarding/google (correct step)
 * - Else if workspaceReady=true and openaiReady!=true and openaiReady!=skipped → redirect to /onboarding/openai
 * - Else if fmProfilesReady!=true → redirect to /onboarding/fm-profiles
 * - Else → redirect to /onboarding/templates
 * 
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
  const cookieOpenaiReady = cookieStore.get("openaiReady")?.value;
  const cookieFmProfilesReady = cookieStore.get("fmProfilesReady")?.value;
  
  // Rule 1: Full onboarding completed → redirect to /pro
  if (cookieOnboardingCompleted === "true") {
    redirect("/pro");
  }
  
  // Rule 2: No workspace → go to /onboarding/google (allow rendering - user might be on correct step)
  if (!cookieWorkspaceReady || cookieWorkspaceReady !== "true") {
    // Allow pages to render - if user is on wrong step, they'll be redirected by page logic
    // or they're on /onboarding/google which is correct
  }
  // Rule 3: Workspace ready but OpenAI not ready/skipped → go to /onboarding/openai
  else if (cookieOpenaiReady !== "true" && cookieOpenaiReady !== "skipped") {
    redirect("/onboarding/openai");
  }
  // Rule 4: FM profiles not ready → go to /onboarding/fm-profiles
  else if (!cookieFmProfilesReady || cookieFmProfilesReady !== "true") {
    redirect("/onboarding/fm-profiles");
  }
  // Rule 5: All ready → go to /onboarding/templates
  else {
    redirect("/onboarding/templates");
  }

  // Allow onboarding pages to render (if we get here, user is on the correct step or will be redirected)
  return (
    <>
      <OnboardingHeader />
      {children}
    </>
  );
}
