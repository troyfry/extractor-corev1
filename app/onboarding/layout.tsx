/**
 * Layout for onboarding pages.
 * 
 * Implements resume logic: determines the correct next step from cookies and redirects if needed.
 * This prevents "random route access" from causing loops.
 * 
 * Resume rules:
 * - If onboardingCompleted=true → redirect to /pro
 * - Else if no workspaceReady → allow /onboarding/google (correct step)
 * - Else if fmProfilesReady!=true → redirect to /onboarding/fm-profiles
 * - Else → redirect to /onboarding/templates
 * 
 * NOTE: OpenAI setup is now optional and skipped in onboarding flow.
 * 
 * NOTE: Uses lightweight checks (cookie-only) to avoid Sheets API quota issues.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { cookies, headers } from "next/headers";

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
  const headersList = await headers();
  
  // Get current pathname from headers (set by middleware)
  const currentPathname = headersList.get("x-pathname") || "";
  
  // Resume logic: decide next step from cookies
  const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
  const cookieWorkspaceReady = cookieStore.get("workspaceReady")?.value;
  const cookieFmProfilesReady = cookieStore.get("fmProfilesReady")?.value;
  
  // Rule 1: Full onboarding completed → redirect to /pro
  if (cookieOnboardingCompleted === "true") {
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
  }

  // Allow onboarding pages to render (if we get here, user is on the correct step)
  return <>{children}</>;
}
