/**
 * Pro Home Page - Server Component Wrapper
 * 
 * Checks onboarding status server-side and redirects if not completed.
 * Uses lightweight cookie check first to avoid Sheets API calls.
 */

import { redirect } from "next/navigation";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { cookies } from "next/headers";
import ProHomePageClient from "./ProHomePageClient";

export default async function ProHomePage() {
  // STEP 1: Check cookie first (no API calls)
  try {
    const cookieStore = await cookies();
    const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
    
    if (cookieOnboardingCompleted === "true") {
      // Cookie indicates onboarding completed, render pro page
      return <ProHomePageClient />;
    }
  } catch (error) {
    // Cookie check failed, continue to status check
  }

  // STEP 2: If cookie missing/false, check status (may hit Sheets API once, with cache)
  const status = await getOnboardingStatus();

  // If user is authenticated but onboarding is not completed, redirect to onboarding
  if (status.isAuthenticated && !status.onboardingCompleted) {
    redirect("/onboarding");
  }

  // If user is not authenticated, middleware will handle redirect to sign-in
  // If onboarding is completed, render the client component
  return <ProHomePageClient />;
}
