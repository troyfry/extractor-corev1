/**
 * Layout for onboarding pages.
 * 
 * Implements resume logic: determines the correct next step from cookies and redirects if needed.
 * This prevents "random route access" from causing loops.
 * 
 * Resume rules:
 * - If onboardingCompleted=true → redirect to /pro
 * - Else if no workspaceReady → allow /onboarding/google (correct step)
<<<<<<< HEAD
 * - Else if fmProfilesReady!=true → redirect to /onboarding/fm-profiles
 * - Else → redirect to /onboarding/templates
 * 
 * NOTE: OpenAI setup is now optional and skipped in onboarding flow.
 * 
=======
 * - Else if workspaceReady=true and openaiReady!=true and openaiReady!=skipped → redirect to /onboarding/openai
 * - Else if fmProfilesReady!=true → redirect to /onboarding/fm-profiles
 * - Else → redirect to /onboarding/templates
 * 
>>>>>>> 130b402b3cadf523754935529ded88e48e20acab
 * NOTE: Uses lightweight checks (cookie-only) to avoid Sheets API quota issues.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
<<<<<<< HEAD
import { cookies, headers } from "next/headers";
=======
import { cookies } from "next/headers";
import { OnboardingHeader } from "@/app/components/onboarding/OnboardingHeader";
>>>>>>> 130b402b3cadf523754935529ded88e48e20acab

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
<<<<<<< HEAD
  const headersList = await headers();
  
  // Get current pathname from headers (set by middleware)
  const currentPathname = headersList.get("x-pathname") || "";
  
  // Resume logic: decide next step from cookies
  const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
  const cookieWorkspaceReady = cookieStore.get("workspaceReady")?.value;
=======
  
  // Resume logic: decide next step from cookies
  const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
  const cookieWorkspaceReady = cookieStore.get("workspaceReady")?.value;
  const cookieOpenaiReady = cookieStore.get("openaiReady")?.value;
>>>>>>> 130b402b3cadf523754935529ded88e48e20acab
  const cookieFmProfilesReady = cookieStore.get("fmProfilesReady")?.value;
  
  // Rule 1: Full onboarding completed → redirect to /pro
  if (cookieOnboardingCompleted === "true") {
<<<<<<< HEAD
    if (!currentPathname.includes("/pro")) {
      redirect("/pro");
    }
  }
  // Rule 2: No workspace → go to /onboarding/google
  else if (!cookieWorkspaceReady || cookieWorkspaceReady !== "true") {
    // Only redirect if not already on /onboarding/google
    if (currentPathname !== "/onboarding/google") {
      redirect("/onboarding/google");
    }
  }
  // Rule 3: FM profiles not ready → go to /onboarding/fm-profiles
  else if (!cookieFmProfilesReady || cookieFmProfilesReady !== "true") {
    // Only redirect if not already on /onboarding/fm-profiles
    if (currentPathname !== "/onboarding/fm-profiles") {
      redirect("/onboarding/fm-profiles");
    }
  }
  // Rule 4: All ready → go to /onboarding/templates
  else {
    // Only redirect if not already on /onboarding/templates
    if (currentPathname !== "/onboarding/templates") {
      redirect("/onboarding/templates");
    }
=======
    redirect("/pro");
>>>>>>> 130b402b3cadf523754935529ded88e48e20acab
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

<<<<<<< HEAD
  // Allow onboarding pages to render (if we get here, user is on the correct step)
  return <>{children}</>;
=======
  // Allow onboarding pages to render (if we get here, user is on the correct step or will be redirected)
  return (
    <>
      <OnboardingHeader />
      {children}
    </>
  );
>>>>>>> 130b402b3cadf523754935529ded88e48e20acab
}
