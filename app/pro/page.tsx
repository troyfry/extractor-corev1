/**
 * Pro Home Page - Server Component Wrapper
 * 
 * Checks onboarding status server-side and redirects if not completed.
 * Uses lightweight cookie check first to avoid Sheets API calls.
 * 
 * IMPORTANT: When cookie says onboardingCompleted=true, we NEVER call getOnboardingStatus()
 * or read the Users sheet. This prevents quota errors on /pro page refreshes.
 */

import { redirect } from "next/navigation";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { cookies } from "next/headers";
import ProHomePageClient from "./ProHomePageClient";

// Mark this route as dynamic since it uses cookies()
export const dynamic = 'force-dynamic';

export default async function ProHomePage() {
  // STEP 1: Check cookie first (no API calls, no Users sheet reads)
  // If cookie says completed, return immediately without any Sheets API calls
  try {
    const cookieStore = await cookies();
    const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
    
    if (cookieOnboardingCompleted === "true") {
      // Cookie indicates onboarding completed - render pro page immediately
      // Do NOT call getOnboardingStatus() - this prevents Users sheet reads
      console.log("[Pro Page] Cookie indicates onboarding completed - rendering without status check");
      return <ProHomePageClient />;
    }
  } catch (error) {
    // Cookie check failed, continue to status check below
    console.warn("[Pro Page] Cookie check failed, falling back to status check:", error);
  }

  // STEP 2: Check for degraded status cookie - if set, skip Sheets calls to prevent retry storms
  try {
    const cookieStore = await cookies();
    const degraded = cookieStore.get("onboardingStatusDegraded")?.value;
    
    if (degraded === "true") {
      console.log("[Pro Page] Status degraded - rendering page with error message without calling getOnboardingStatus()");
      return <ProHomePageClient quotaError={true} />;
    }
  } catch (error) {
    // Continue if cookie check fails
  }

  // STEP 3: Only if cookie missing/false and not degraded, check status (may hit Sheets API once, with cache)
  // This path is only taken when cookie is missing or false and status is not degraded
  const status = await getOnboardingStatus();

  // If quota error occurred, render page with error message (do NOT redirect - prevents refresh loop)
  if (status.quotaError) {
    console.warn("[Pro Page] Quota error detected - rendering page with error message instead of redirecting");
    return <ProHomePageClient quotaError={true} />;
  }

  // If user is authenticated but onboarding is not completed, redirect to onboarding
  // Only redirect if we're confident (not a quota fallback)
  if (status.isAuthenticated && !status.onboardingCompleted) {
    redirect("/onboarding");
  }

  // If user is not authenticated, middleware will handle redirect to sign-in
  // If onboarding is completed, render the client component
  return <ProHomePageClient />;
}
