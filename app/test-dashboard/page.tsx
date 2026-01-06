"use client";

import { useEffect, useState } from "react";

interface TestResult {
  assertionResults: Array<{
    ancestorTitles: string[];
    fullName: string;
    status: "passed" | "failed" | "skipped";
    title: string;
    duration: number;
    failureMessages: string[];
  }>;
  name: string;
  status: "passed" | "failed";
  startTime: number;
  endTime: number;
}

interface TestReport {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: TestResult[];
  success: boolean;
  startTime: number;
}

interface CategorizedTests {
  category: string;
  file: string;
  suites: Array<{
    suiteName: string;
    tests: Array<{
      name: string;
      status: "passed" | "failed" | "skipped";
      duration: number;
      failureMessages: string[];
    }>;
  }>;
  status: "passed" | "failed";
}

export default function TestDashboard() {
  const [report, setReport] = useState<TestReport | null>(null);
  const [categorized, setCategorized] = useState<CategorizedTests[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/test-results.json")
      .then((res) => res.json())
      .then((data: TestReport) => {
        setReport(data);
        setCategorized(categorizeTests(data));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  function categorizeTests(report: TestReport): CategorizedTests[] {
    const categories = new Map<string, CategorizedTests[]>();

    report.testResults.forEach((result) => {
      // Extract category from file path (e.g., "tests/pdf/intent.test.ts" -> "pdf")
      const pathMatch = result.name.match(/tests[\\/]([^\\/]+)[\\/]/);
      const category = pathMatch ? pathMatch[1] : "other";

      // Extract filename
      const filename = result.name.split(/[\\/]/).pop() || "unknown";

      // Group tests by suite (ancestorTitles)
      const suitesMap = new Map<string, typeof result.assertionResults>();

      result.assertionResults.forEach((test) => {
        // Use the first ancestor title as the suite name, or "Default" if none
        const suiteName = test.ancestorTitles[0] || "Default";

        if (!suitesMap.has(suiteName)) {
          suitesMap.set(suiteName, []);
        }
        suitesMap.get(suiteName)!.push(test);
      });

      const suites = Array.from(suitesMap.entries()).map(([suiteName, tests]) => ({
        suiteName,
        tests: tests.map((t) => ({
          name: t.title,
          status: t.status,
          duration: t.duration,
          failureMessages: t.failureMessages,
        })),
      }));

      if (!categories.has(category)) {
        categories.set(category, []);
      }

      categories.get(category)!.push({
        category,
        file: filename,
        suites,
        status: result.status,
      });
    });

    // Convert to array and sort
    const result: CategorizedTests[] = [];
    categories.forEach((files) => {
      result.push(...files);
    });

    return result.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.file.localeCompare(b.file);
    });
  }

  function getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      pdf: "bg-blue-100 text-blue-800 border-blue-300",
      templates: "bg-green-100 text-green-800 border-green-300",
      signed: "bg-purple-100 text-purple-800 border-purple-300",
      coords: "bg-yellow-100 text-yellow-800 border-yellow-300",
      gmail: "bg-red-100 text-red-800 border-red-300",
      workspace: "bg-indigo-100 text-indigo-800 border-indigo-300",
    };
    return colors[category] || "bg-gray-100 text-gray-800 border-gray-300";
  }

  function getStatusBadge(status: "passed" | "failed" | "skipped"): JSX.Element {
    if (status === "passed") {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          ✓ Passed
        </span>
      );
    } else if (status === "failed") {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          ✗ Failed
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          ⊘ Skipped
        </span>
      );
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading test results...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error loading test results: {error}</p>
          <p className="text-gray-600 text-sm">
            Make sure to run <code className="bg-gray-200 px-2 py-1 rounded">npm test -- --reporter=json --outputFile=test-results.json</code> first
          </p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">No test results found.</p>
        </div>
      </div>
    );
  }

  const passRate = ((report.numPassedTests / report.numTotalTests) * 100).toFixed(1);
  const suitePassRate = ((report.numPassedTestSuites / report.numTotalTestSuites) * 100).toFixed(1);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Unit Test Dashboard</h1>
          <p className="text-gray-600">Categorized test results with pass/fail status</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Tests</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{report.numTotalTests}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Passed</div>
            <div className="mt-2 text-3xl font-bold text-green-600">{report.numPassedTests}</div>
            <div className="mt-1 text-sm text-gray-500">{passRate}% pass rate</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Failed</div>
            <div className="mt-2 text-3xl font-bold text-red-600">{report.numFailedTests}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Test Suites</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{report.numTotalTestSuites}</div>
            <div className="mt-1 text-sm text-gray-500">{suitePassRate}% pass rate</div>
          </div>
        </div>

        {/* Overall Status */}
        <div className={`mb-8 p-4 rounded-lg ${report.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          <div className="flex items-center">
            {report.success ? (
              <>
                <svg className="h-6 w-6 text-green-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-green-800 font-semibold">All tests passed!</span>
              </>
            ) : (
              <>
                <svg className="h-6 w-6 text-red-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-red-800 font-semibold">Some tests failed</span>
              </>
            )}
          </div>
        </div>

        {/* Categorized Tests */}
        <div className="space-y-6">
          {Object.entries(
            categorized.reduce((acc, item) => {
              if (!acc[item.category]) acc[item.category] = [];
              acc[item.category].push(item);
              return acc;
            }, {} as Record<string, CategorizedTests[]>)
          ).map(([category, files]) => (
            <div key={category} className="bg-white rounded-lg shadow">
              <div className={`px-6 py-4 border-b ${getCategoryColor(category)}`}>
                <h2 className="text-xl font-semibold capitalize">{category}</h2>
                <p className="text-sm mt-1">
                  {files.length} file{files.length !== 1 ? "s" : ""} •{" "}
                  {files.reduce((sum, f) => sum + f.suites.reduce((s, suite) => s + suite.tests.length, 0), 0)} tests
                </p>
              </div>

              <div className="divide-y">
                {files.map((file, fileIdx) => (
                  <div key={fileIdx} className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-medium text-gray-900 font-mono text-sm">{file.file}</h3>
                      {getStatusBadge(file.status)}
                    </div>

                    {file.suites.map((suite, suiteIdx) => (
                      <div key={suiteIdx} className="mb-6 last:mb-0">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">{suite.suiteName}</h4>
                        <div className="space-y-2 ml-4">
                          {suite.tests.map((test, testIdx) => (
                            <div
                              key={testIdx}
                              className={`p-3 rounded border-l-4 ${
                                test.status === "passed"
                                  ? "bg-green-50 border-green-400"
                                  : test.status === "failed"
                                  ? "bg-red-50 border-red-400"
                                  : "bg-gray-50 border-gray-400"
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    {test.status === "passed" ? (
                                      <span className="text-green-600 font-bold">✓</span>
                                    ) : test.status === "failed" ? (
                                      <span className="text-red-600 font-bold">✗</span>
                                    ) : (
                                      <span className="text-gray-600 font-bold">⊘</span>
                                    )}
                                    <span className="text-sm text-gray-900">{test.name}</span>
                                  </div>
                                  {test.failureMessages.length > 0 && (
                                    <div className="mt-2 ml-6">
                                      <details className="text-xs">
                                        <summary className="cursor-pointer text-red-600 font-medium">View error details</summary>
                                        <pre className="mt-2 p-2 bg-red-100 rounded text-red-800 whitespace-pre-wrap">
                                          {test.failureMessages.join("\n")}
                                        </pre>
                                      </details>
                                    </div>
                                  )}
                                </div>
                                <span className="text-xs text-gray-500 ml-4">{formatDuration(test.duration)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            Last updated: {report.startTime ? new Date(report.startTime).toLocaleString() : "Unknown"}
          </p>
          <p className="mt-2">
            Run <code className="bg-gray-200 px-2 py-1 rounded">npm test -- --reporter=json --outputFile=test-results.json</code> to refresh
          </p>
        </div>
      </div>
    </div>
  );
}

