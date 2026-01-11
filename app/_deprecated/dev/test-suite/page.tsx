"use client";

import React, { useState } from "react";
import AppShell from "@/components/layout/AppShell";

/**
 * Developer Test Suite
 * 
 * Provides tools and test files for development and testing.
 */
export default function DevTestSuite() {
  const [mockExtractResult, setMockExtractResult] = useState<any>(null);
  const [mockLimitsResult, setMockLimitsResult] = useState<any>(null);
  const [isLoadingExtract, setIsLoadingExtract] = useState(false);
  const [isLoadingLimits, setIsLoadingLimits] = useState(false);
  const [limitsData, setLimitsData] = useState<any>(null);
  const [resetResult, setResetResult] = useState<any>(null);
  const [isLoadingLimitsView, setIsLoadingLimitsView] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [ipHash, setIpHash] = useState<string>("");

  const handleMockExtract = async () => {
    setIsLoadingExtract(true);
    setMockExtractResult(null);
    try {
      const response = await fetch("/api/dev/mock-extract", {
        method: "POST",
      });
      const data = await response.json();
      setMockExtractResult(data);
    } catch (error) {
      setMockExtractResult({ error: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setIsLoadingExtract(false);
    }
  };

  const handleMockLimits = async (state: string) => {
    setIsLoadingLimits(true);
    setMockLimitsResult(null);
    try {
      const response = await fetch(`/api/dev/mock-limits?state=${state}`);
      const data = await response.json();
      setMockLimitsResult({ state, status: response.status, data });
    } catch (error) {
      setMockLimitsResult({ 
        state, 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    } finally {
      setIsLoadingLimits(false);
    }
  };

  const handleViewLimits = async () => {
    setIsLoadingLimitsView(true);
    setLimitsData(null);
    try {
      const url = ipHash 
        ? `/api/dev/reset-limits?ip=${encodeURIComponent(ipHash)}`
        : `/api/dev/reset-limits`;
      const response = await fetch(url);
      const data = await response.json();
      setLimitsData({ status: response.status, data });
    } catch (error) {
      setLimitsData({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    } finally {
      setIsLoadingLimitsView(false);
    }
  };

  const handleResetLimits = async (scope: string) => {
    setIsResetting(true);
    setResetResult(null);
    try {
      const params = new URLSearchParams({ scope });
      if (ipHash) {
        params.append("ip", ipHash);
      }
      const response = await fetch(`/api/dev/reset-limits?${params.toString()}`, {
        method: "DELETE",
      });
      const data = await response.json();
      setResetResult({ scope, status: response.status, data });
      // Refresh limits view after reset
      if (limitsData) {
        handleViewLimits();
      }
    } catch (error) {
      setResetResult({ 
        scope,
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <AppShell>
      <main className="min-h-screen bg-gray-900 text-white p-10">
        <div className="max-w-4xl mx-auto space-y-8">
          <h1 className="text-3xl font-bold">Developer Test Suite</h1>

          {/* Mock Extraction Section */}
          <section className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Mock Extraction</h2>
            <p className="text-gray-400 mb-4">
              Test the extraction response format without processing a PDF.
            </p>
            <button
              onClick={handleMockExtract}
              disabled={isLoadingExtract}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isLoadingExtract ? "Loading..." : "Test Mock Extract"}
            </button>
            {mockExtractResult && (
              <div className="mt-4 p-4 bg-gray-700 rounded">
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(mockExtractResult, null, 2)}
                </pre>
              </div>
            )}
          </section>

          {/* Mock Rate Limits Section */}
          <section className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Mock Rate Limits</h2>
            <p className="text-gray-400 mb-4">
              Test rate limit responses. Try different states: ok, daily, monthly, global
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => handleMockLimits("ok")}
                disabled={isLoadingLimits}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Test: OK
              </button>
              <button
                onClick={() => handleMockLimits("daily")}
                disabled={isLoadingLimits}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Test: Daily Limit
              </button>
              <button
                onClick={() => handleMockLimits("monthly")}
                disabled={isLoadingLimits}
                className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Test: Monthly Limit
              </button>
              <button
                onClick={() => handleMockLimits("global")}
                disabled={isLoadingLimits}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Test: Global Limit
              </button>
            </div>
            {mockLimitsResult && (
              <div className="mt-4 p-4 bg-gray-700 rounded">
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(mockLimitsResult, null, 2)}
                </pre>
              </div>
            )}
          </section>

          {/* Reset Limits Section */}
          <section className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Reset Free Tier Limits</h2>
            <p className="text-gray-400 mb-4">
              View and reset free tier usage limits for development testing.
            </p>
            
            {/* IP Hash Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                IP Hash (optional - leave empty for all IPs):
              </label>
              <input
                type="text"
                value={ipHash}
                onChange={(e) => setIpHash(e.target.value)}
                placeholder="Enter IP hash or leave empty"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Filter by specific IP hash, or leave empty to view/reset all IPs
              </p>
            </div>

            {/* View Limits */}
            <div className="mb-4">
              <button
                onClick={handleViewLimits}
                disabled={isLoadingLimitsView}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isLoadingLimitsView ? "Loading..." : "View Current Limits"}
              </button>
            </div>

            {limitsData && (
              <div className="mb-4 p-4 bg-gray-700 rounded">
                <h3 className="text-sm font-semibold mb-2">Current Limits:</h3>
                <pre className="text-xs overflow-auto max-h-64">
                  {JSON.stringify(limitsData, null, 2)}
                </pre>
              </div>
            )}

            {/* Reset Buttons */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-300 mb-2">Reset Limits:</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleResetLimits("all")}
                  disabled={isResetting}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isResetting ? "Resetting..." : "Reset All"}
                </button>
                <button
                  onClick={() => handleResetLimits("daily")}
                  disabled={isResetting}
                  className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isResetting ? "Resetting..." : "Reset Daily"}
                </button>
                <button
                  onClick={() => handleResetLimits("monthly")}
                  disabled={isResetting}
                  className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isResetting ? "Resetting..." : "Reset Monthly"}
                </button>
                <button
                  onClick={() => handleResetLimits("global")}
                  disabled={isResetting}
                  className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isResetting ? "Resetting..." : "Reset Global"}
                </button>
              </div>
            </div>

            {resetResult && (
              <div className="mt-4 p-4 bg-gray-700 rounded">
                <h3 className="text-sm font-semibold mb-2">Reset Result:</h3>
                <pre className="text-xs overflow-auto">
                  {JSON.stringify(resetResult, null, 2)}
                </pre>
              </div>
            )}

            <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded">
              <p className="text-xs text-yellow-300">
                ⚠️ <strong>Note:</strong> This endpoint is only available in development mode. 
                In production, it will return a 403 error.
              </p>
            </div>
          </section>

          {/* Test PDFs Section */}
          <section className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Test PDFs</h2>
            <p className="text-gray-400 mb-4">
              Download test PDF files for development and testing.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <a 
                  href="/dev/pdfs/clean-wo.pdf" 
                  download
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Clean Work Order
                </a>
                <span className="text-gray-500 ml-2">- Well-formatted work order</span>
              </li>
              <li>
                <a 
                  href="/dev/pdfs/messy-wo.pdf" 
                  download
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Messy Layout
                </a>
                <span className="text-gray-500 ml-2">- Poorly formatted work order</span>
              </li>
              <li>
                <a 
                  href="/dev/pdfs/missing-fields.pdf" 
                  download
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Missing Fields
                </a>
                <span className="text-gray-500 ml-2">- Work order with incomplete data</span>
              </li>
              <li>
                <a 
                  href="/dev/pdfs/facility-format-a.pdf" 
                  download
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Facility Format A
                </a>
                <span className="text-gray-500 ml-2">- Standard facility format variant</span>
              </li>
              <li>
                <a 
                  href="/dev/pdfs/facility-format-b.pdf" 
                  download
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  Facility Format B
                </a>
                <span className="text-gray-500 ml-2">- Alternative facility format variant</span>
              </li>
            </ul>
            <p className="text-sm text-gray-500 mt-4">
              Note: These PDF files need to be added to <code className="bg-gray-700 px-1 rounded">public/dev/pdfs/</code>
            </p>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

