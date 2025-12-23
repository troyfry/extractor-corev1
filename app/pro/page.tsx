/**
 * Pro Home Page - Server Component Wrapper
 * 
 * Checks onboarding status server-side and redirects if not completed.
 * This prevents the 6-second delay from client-side checks.
 */

import { redirect } from "next/navigation";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import ProHomePageClient from "./ProHomePageClient";

export default async function ProHomePage() {
  // Check onboarding status server-side
  const status = await getOnboardingStatus();

  // If user is authenticated but onboarding is not completed, redirect to onboarding
  if (status.isAuthenticated && !status.onboardingCompleted) {
    redirect("/onboarding");
  }

  // If user is not authenticated, middleware will handle redirect to sign-in
  // If onboarding is completed, render the client component
  return <ProHomePageClient />;
}
