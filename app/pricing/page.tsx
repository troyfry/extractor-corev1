"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import { isDevMode } from "@/lib/env";

export default function PricingPage() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  
  // Automatically show Pro/Premium tiers in dev mode
  // In production, only show if NEXT_PUBLIC_SHOW_DEV_TIERS=true
  const showDevTiers = isDevMode || process.env.NEXT_PUBLIC_SHOW_DEV_TIERS === "true";

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const faqs = [
    {
      question: "Do I need an account to use the Free Core Version?",
      answer: "No. You can use it immediately without any account or login.",
    },
    {
      question: "Can I upgrade later?",
      answer: "Yes, upgrading unlocks automation features but the Free version will always remain available.",
    },
    {
      question: "Is my data secure?",
      answer: "All processing happens securely using our server-side AI. No data is stored on the free tier. Paid plans enable saving and history.",
    },
    {
      question: "What makes Pro worth it?",
      answer: "Teams processing signed work orders daily gain huge time savings with email ingestion, matching, and faster extraction.",
    },
    {
      question: "What does Premium include?",
      answer: "Premium includes portals, automations, integrations, and dashboard access for larger teams.",
    },
  ];

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-gray-900 text-white">
        {/* Hero Section */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Choose the Plan That Fits Your Workflow
          </h1>
          <p className="text-xl text-gray-400 mb-8">
            Start free. Upgrade only when you need automation and speed.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href={ROUTES.free}
              className="px-6 py-3 bg-gray-700 text-white rounded hover:bg-gray-600 font-medium transition-colors"
            >
              Use Free Version
            </Link>
            {showDevTiers ? (
              <>
                <a
                  href="#pro"
                  className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium transition-colors"
                >
                  Start Pro
                </a>
                <a
                  href="#premium"
                  className="px-6 py-3 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium transition-colors"
                >
                  See Premium
                </a>
              </>
            ) : (
              <>
                <button
                  disabled
                  className="px-6 py-3 bg-gray-600 text-gray-400 rounded opacity-50 cursor-not-allowed font-medium"
                >
                  Start Pro (Coming Soon)
                </button>
                <button
                  disabled
                  className="px-6 py-3 bg-gray-600 text-gray-400 rounded opacity-50 cursor-not-allowed font-medium"
                >
                  See Premium (Coming Soon)
                </button>
              </>
            )}
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className={`grid gap-8 ${showDevTiers ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 max-w-md mx-auto"}`}>
            {/* Free Core Version */}
            <div className="bg-gray-800 border-2 border-blue-500 rounded-lg p-8 relative">
              <div className="absolute top-4 right-4">
                <span className="px-3 py-1 bg-blue-600 text-blue-200 rounded text-xs font-medium">
                  Popular
                </span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Free Core Version</h2>
              <div className="mb-4">
                <span className="text-4xl font-bold text-white">$0</span>
              </div>
              <p className="text-gray-400 mb-6">
                A powerful work order extractor you can use immediately — no login required.
              </p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300">Upload PDFs</span>
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300">Extract work order data</span>
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300">CSV download</span>
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300">Fast, lightweight, simple</span>
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300">No signup required</span>
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-300">Rate limited for fair use</span>
                </li>
              </ul>
              <Link
                href={ROUTES.free}
                className="block w-full text-center px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium transition-colors"
              >
                Use Free Version
              </Link>
            </div>

            {/* Pro */}
            {showDevTiers && (
              <div id="pro" className="bg-gray-800 border border-gray-700 rounded-lg p-8">
                <h2 className="text-2xl font-bold text-white mb-2">Pro</h2>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-white">$XX</span>
                  <span className="text-gray-400">/month</span>
                </div>
                <p className="text-gray-400 mb-6">
                  Automation for teams who want speed and inbox-to-invoice workflows.
                </p>
                <ul className="space-y-3 mb-8">
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Unlimited batch size</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">5× faster parallel extraction</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Larger file support</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Automatically pull signed work orders from email</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Automatic matching</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <div className="flex-1">
                      <span className="text-gray-300 font-medium">Invoice preparation tools:</span>
                      <ul className="mt-2 ml-4 space-y-1.5 text-sm text-gray-400">
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Validation panel</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Auto-match signed work orders</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Billable amount helper</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Invoice-ready CSV export</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Customer summary batching</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Prepare QuickBooks/Wave import files</span>
                        </li>
                      </ul>
                    </div>
                  </li>
                </ul>
                <button
                  onClick={() => alert("Pro signup coming soon!")}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium transition-colors"
                >
                  Start Pro
                </button>
              </div>
            )}

            {/* Premium */}
            {showDevTiers && (
              <div id="premium" className="bg-gray-800 border border-gray-700 rounded-lg p-8">
                <h2 className="text-2xl font-bold text-white mb-2">Premium</h2>
                <div className="mb-4">
                  <span className="text-4xl font-bold text-white">$XXX</span>
                  <span className="text-gray-400">/month</span>
                </div>
                <p className="text-gray-400 mb-6">
                  Full-suite automation, portals, integrations, and priority processing.
                </p>
                <ul className="space-y-3 mb-8">
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Everything in Pro</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Customer portal</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <div className="flex-1">
                      <span className="text-gray-300 font-medium">Advanced invoice features:</span>
                      <ul className="mt-2 ml-4 space-y-1.5 text-sm text-gray-400">
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Smart invoice drafts</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Auto-filled invoice templates</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>QuickBooks + Make.com prep flows</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Invoice folder automation</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-green-400 mt-0.5">✓</span>
                          <span>Priority processing</span>
                        </li>
                      </ul>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Invoice dashboard</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">QuickBooks + n8n/Make integrations</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Priority extraction speed</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-300">Dedicated support</span>
                  </li>
                </ul>
                <button
                  onClick={() => alert("Premium demo booking coming soon!")}
                  className="w-full px-6 py-3 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium transition-colors"
                >
                  Book Demo
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Comparison Table */}
        {showDevTiers && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
            <h2 className="text-3xl font-bold text-white text-center mb-8">Feature Comparison</h2>
            <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Feature</th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-gray-300">Free Core Version</th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-gray-300">Pro</th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-gray-300">Premium</th>
                    </tr>
                  </thead>
                <tbody className="divide-y divide-gray-700">
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Batch size</td>
                    <td className="px-6 py-4 text-center text-gray-400">Limited</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Processing speed</td>
                    <td className="px-6 py-4 text-center text-gray-400">Standard</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Server-side AI processing</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Email ingestion</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Signed copy matching</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Validation panel</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Invoice generation</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Integrations</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-gray-300">Customer portal</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center text-gray-400">—</td>
                    <td className="px-6 py-4 text-center">
                      <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )}

        {/* FAQ Section */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <h2 className="text-3xl font-bold text-white text-center mb-8">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div key={index} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleFaq(index)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-700 transition-colors"
                >
                  <span className="text-white font-medium">{faq.question}</span>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${expandedFaq === index ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedFaq === index && (
                  <div className="px-6 py-4 border-t border-gray-700">
                    <p className="text-gray-300">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 text-center">
          <p className="text-xl text-gray-400 mb-6">
            Start with the Free Core Version — no login required.
          </p>
          <Link
            href="/free"
            className="inline-block px-8 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium transition-colors"
          >
            Use Free Version
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

