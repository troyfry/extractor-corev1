/**
 * Layout for onboarding pages.
 * 
 * This layout checks if onboarding is already completed and redirects to /pro if so.
 * This prevents users from accessing onboarding pages after completion.
 */

import { redirect } from "next/navigation";
import { getOnboardingStatus } from "@/lib/onboarding/status";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check onboarding status server-side
  const status = await getOnboardingStatus();

  // If user is authenticated and onboarding is completed, redirect to /pro
  if (status.isAuthenticated && status.onboardingCompleted) {
    redirect("/pro");
  }

  // If user is not authenticated, allow access (middleware will handle auth redirect)
  // If user is authenticated but onboarding not completed, allow access to onboarding pages
  return <>{children}</>;
}

