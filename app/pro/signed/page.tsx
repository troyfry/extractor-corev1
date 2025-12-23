"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SignedWorkOrdersPage() {
  const router = useRouter();

  // Redirect to the existing signed-test page
  useEffect(() => {
    router.replace("/pro/signed-test");
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-slate-400">Redirecting...</p>
    </div>
  );
}

