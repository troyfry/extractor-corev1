"use client";

import React from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";

export default function SignedPage() {
  return (
    <AppShell>
      <MainNavigation currentMode="signed" />
      <div className="min-h-screen bg-gray-900 text-white pt-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white mb-2">
              Signed Documents
            </h1>
            <p className="text-sm text-gray-400">
              Upload signed work orders and match them to existing jobs.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 mb-6">
            {/* Upload Section */}
            <Link
              href={ROUTES.signedUpload}
              className="block bg-gray-800 rounded-lg border border-gray-700 p-6 hover:border-blue-500 transition-colors"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Upload Signed PDFs
                  </h2>
                  <p className="text-sm text-gray-400">
                    Upload and process signed work orders
                  </p>
                </div>
              </div>
            </Link>

            {/* Needs Review Section */}
            <Link
              href={ROUTES.signedNeedsReview}
              className="block bg-gray-800 rounded-lg border border-gray-700 p-6 hover:border-yellow-500 transition-colors"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-yellow-600 rounded-lg flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Needs Review
                  </h2>
                  <p className="text-sm text-gray-400">
                    Verify and resolve items requiring attention
                  </p>
                </div>
              </div>
            </Link>
          </div>

          {/* Work Orders Link */}
          <div className="mt-6">
            <Link
              href={ROUTES.workOrders}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              View Work Orders
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
