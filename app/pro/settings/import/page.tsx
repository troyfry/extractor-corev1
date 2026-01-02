"use client";

import { useState } from "react";
import AppShell from "@/components/layout/AppShell";
import MainNavigation from "@/components/layout/MainNavigation";
import type { ImportMapping, ImportPreview } from "@/lib/importer/types";

export default function ImportPage() {
  const [externalSpreadsheetId, setExternalSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("Sheet1");
  const [externalHeaders, setExternalHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({
    wo_number: "",
  });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isLoadingHeaders, setIsLoadingHeaders] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Canonical field names for mapping
  const canonicalFields = [
    { key: "wo_number", label: "Work Order Number", required: true },
    { key: "fmKey", label: "FM Key", required: false },
    { key: "status", label: "Status", required: false },
    { key: "scheduled_date", label: "Scheduled Date", required: false },
    { key: "customer_name", label: "Customer Name", required: false },
    { key: "vendor_name", label: "Vendor Name", required: false },
    { key: "service_address", label: "Service Address", required: false },
    { key: "job_type", label: "Job Type", required: false },
    { key: "job_description", label: "Job Description", required: false },
    { key: "amount", label: "Amount", required: false },
    { key: "currency", label: "Currency", required: false },
    { key: "notes", label: "Notes", required: false },
    { key: "priority", label: "Priority", required: false },
    { key: "calendar_event_link", label: "Calendar Event Link", required: false },
    { key: "work_order_pdf_link", label: "Work Order PDF Link", required: false },
  ];

  const handleLoadHeaders = async () => {
    if (!externalSpreadsheetId) {
      setError("Please enter a spreadsheet ID");
      return;
    }

    setIsLoadingHeaders(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/import/headers?spreadsheetId=${encodeURIComponent(externalSpreadsheetId)}&sheetName=${encodeURIComponent(sheetName)}`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to load headers");
      }

      const data = await response.json();
      setExternalHeaders(data.headers || []);
      
      // Auto-map if possible (case-insensitive match)
      const autoMapping: Partial<ImportMapping> = {};
      canonicalFields.forEach((field) => {
        const match = data.headers.find((h: string) =>
          h.toLowerCase().trim() === field.key.toLowerCase() ||
          h.toLowerCase().trim() === field.label.toLowerCase()
        );
        if (match) {
          autoMapping[field.key as keyof ImportMapping] = match;
        }
      });
      
      setMapping((prev) => ({ ...prev, ...autoMapping }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load headers");
    } finally {
      setIsLoadingHeaders(false);
    }
  };

  const handlePreview = async () => {
    if (!externalSpreadsheetId || !mapping.wo_number) {
      setError("Please enter spreadsheet ID and map Work Order Number");
      return;
    }

    setIsLoadingPreview(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalSpreadsheetId,
          sheetName,
          mapping,
          previewLimit: 10,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to preview import");
      }

      const data = await response.json();
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview import");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!externalSpreadsheetId || !mapping.wo_number) {
      setError("Please enter spreadsheet ID and map Work Order Number");
      return;
    }

    if (!confirm("Are you sure you want to import? This will add new records to your Work Orders sheet.")) {
      return;
    }

    setIsImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalSpreadsheetId,
          sheetName,
          mapping,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to import");
      }

      const data = await response.json();
      setSuccess(data.message || "Import completed successfully");
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <AppShell>
      <MainNavigation />
      <div className="min-h-screen bg-slate-900">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-white mb-2">Import External Spreadsheet</h1>
          <p className="text-slate-400 mb-6">
            Import work orders from an external Google Sheet into your internal Work Orders sheet.
            <br />
            <strong className="text-yellow-400">We will not modify your spreadsheet; this copies data into your app sheet.</strong>
          </p>

          {/* Error/Success Messages */}
          {error && (
            <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-4 bg-green-900/30 border border-green-700 rounded-lg text-green-200">
              {success}
            </div>
          )}

          {/* Step 1: External Sheet Info */}
          <section className="mb-8 p-6 bg-slate-800 rounded-xl border border-slate-700">
            <h2 className="text-xl font-semibold text-white mb-4">Step 1: External Spreadsheet</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="spreadsheet-id" className="block text-sm font-medium text-slate-300 mb-2">
                  External Spreadsheet ID
                </label>
                <input
                  id="spreadsheet-id"
                  type="text"
                  value={externalSpreadsheetId}
                  onChange={(e) => setExternalSpreadsheetId(e.target.value)}
                  placeholder="Enter the spreadsheet ID from the URL"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Found in the URL: https://docs.google.com/spreadsheets/d/<strong>SPREADSHEET_ID</strong>/edit
                </p>
              </div>
              <div>
                <label htmlFor="sheet-name" className="block text-sm font-medium text-slate-300 mb-2">
                  Sheet Name
                </label>
                <input
                  id="sheet-name"
                  type="text"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  placeholder="Sheet1"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleLoadHeaders}
                disabled={isLoadingHeaders || !externalSpreadsheetId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {isLoadingHeaders ? "Loading..." : "Load Headers"}
              </button>
            </div>
          </section>

          {/* Step 2: Column Mapping */}
          {externalHeaders.length > 0 && (
            <section className="mb-8 p-6 bg-slate-800 rounded-xl border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">Step 2: Map Columns</h2>
              <p className="text-sm text-slate-400 mb-4">
                Map external column names to our internal fields. Work Order Number is required.
              </p>
              <div className="space-y-3">
                {canonicalFields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium text-slate-300 mb-1">
                      {field.label}
                      {field.required && <span className="text-red-400"> *</span>}
                    </label>
                    <select
                      value={mapping[field.key as keyof ImportMapping] || ""}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [field.key]: e.target.value || undefined,
                        }))
                      }
                      className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Not mapped --</option>
                      {externalHeaders.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={handlePreview}
                  disabled={isLoadingPreview || !mapping.wo_number}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                  {isLoadingPreview ? "Previewing..." : "Preview Import"}
                </button>
              </div>
            </section>
          )}

          {/* Step 3: Preview Results */}
          {preview && (
            <section className="mb-8 p-6 bg-slate-800 rounded-xl border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">Step 3: Preview</h2>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-slate-700 rounded-lg">
                  <div className="text-sm text-slate-400">Total Rows</div>
                  <div className="text-2xl font-bold text-white">{preview.totalRows}</div>
                </div>
                <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg">
                  <div className="text-sm text-green-300">New</div>
                  <div className="text-2xl font-bold text-green-200">{preview.newCount}</div>
                </div>
                <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                  <div className="text-sm text-yellow-300">Duplicates</div>
                  <div className="text-2xl font-bold text-yellow-200">{preview.duplicateCount}</div>
                </div>
                <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
                  <div className="text-sm text-red-300">Conflicts</div>
                  <div className="text-2xl font-bold text-red-200">{preview.conflictCount}</div>
                </div>
              </div>

              {preview.errors.length > 0 && (
                <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-200 text-sm">
                  <strong>Errors:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {preview.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.sampleRows.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-slate-300 mb-2">Sample Rows:</h3>
                  <div className="space-y-2">
                    {preview.sampleRows.map((sample, idx) => (
                      <div key={idx} className="p-3 bg-slate-700 rounded border border-slate-600">
                        <div className="text-xs text-slate-400 mb-1">
                          Status: <span className={
                            sample.dedupe.status === "new" ? "text-green-400" :
                            sample.dedupe.status === "duplicate" ? "text-yellow-400" :
                            "text-red-400"
                          }>{sample.dedupe.status.toUpperCase()}</span>
                        </div>
                        <div className="text-sm text-white">
                          WO#: {sample.canonical.wo_number} | 
                          Customer: {sample.canonical.customer_name || "N/A"} | 
                          Amount: {sample.canonical.amount || "N/A"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={isImporting || preview.newCount === 0}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {isImporting ? "Importing..." : `Import ${preview.newCount} New Records`}
              </button>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

