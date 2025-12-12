"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";

/**
 * Legacy /manual page - redirects to appropriate page based on auth status.
 * 
 * This page is deprecated. It redirects:
 * - Unauthenticated users → /free (public free tier)
 * - Authenticated users → /dashboard (Pro tier)
 * 
 * The /manual page previously had BYOK functionality which has been removed.
 * All file upload functionality is now in /free (public) and /dashboard (Pro).
 */
export default function ManualUploadPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        const response = await fetch("/api/auth/session");
        const session = await response.json();
        
        if (session && session.user) {
          // Authenticated user → redirect to dashboard
          router.replace("/dashboard");
        } else {
          // Unauthenticated user → redirect to free tier
          router.replace("/free");
        }
      } catch (error) {
        console.error("Error checking auth:", error);
        // On error, redirect to free tier (public)
        router.replace("/free");
      } finally {
        setIsChecking(false);
      }
    };

    checkAuthAndRedirect();
  }, [router]);

  // Show loading state while redirecting
  if (isChecking) {
    return (
      <AppShell>
        <div className="min-h-screen bg-gray-900 text-white pt-8">
          <div className="text-center text-gray-400">Redirecting...</div>
        </div>
      </AppShell>
    );
  }

  return null;
}
