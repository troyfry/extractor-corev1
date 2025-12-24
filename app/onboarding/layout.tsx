/**
 * Layout for onboarding pages.
 * 
 * This layout checks if onboarding is already completed or if spreadsheet is set, and redirects to /pro if so.
 * This prevents users from accessing onboarding pages after setup is done.
 * 
 * NOTE: Uses lightweight checks (cookie/session only) to avoid Sheets API quota issues.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getUserSpreadsheetId } from "@/lib/userSettings/repository";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Lightweight check: only check cookie and session (no Sheets API calls)
  const user = await getCurrentUser();
  
  if (!user || !user.userId) {
    // Not authenticated, allow access (middleware will handle auth redirect)
    return <>{children}</>;
  }

  // Check onboardingCompleted cookie first (most reliable indicator)
  const cookieStore = await cookies();
  const cookieOnboardingCompleted = cookieStore.get("onboardingCompleted")?.value;
  
  if (cookieOnboardingCompleted === "true") {
    // Onboarding is completed, redirect to /pro
    redirect("/pro");
  }

  // If onboardingCompleted cookie is not set, allow access to onboarding pages
  // Even if googleSheetsSpreadsheetId is set (user might be mid-onboarding)
  return <>{children}</>;
}

