"use client";

import React, { useState, useMemo } from "react";
import type { WorkOrder } from "@/lib/workOrders/types";

interface ResultsTableProps {
  rows: WorkOrder[];
}

type SortField = keyof WorkOrder | null;
type SortDirection = "asc" | "desc";

export default function ResultsTable({ rows }: ResultsTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Filter and sort rows
  const filteredAndSortedRows = useMemo(() => {
    let filtered = rows.filter((row) => {
      const query = searchQuery.toLowerCase();
      return (
        row.workOrderNumber.toLowerCase().includes(query) ||
        (row.customerName && row.customerName.toLowerCase().includes(query)) ||
        (row.vendorName && row.vendorName.toLowerCase().includes(query)) ||
        (row.serviceAddress && row.serviceAddress.toLowerCase().includes(query))
      );
    });

    if (sortField) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        const comparison =
          aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [rows, searchQuery, sortField, sortDirection]);

  const handleSort = (field: keyof WorkOrder) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleDownloadCSV = () => {
    // Use server-side CSV export endpoint for security
    window.location.href = "/api/work-orders/export";
  };

  const handleCopyToClipboard = async () => {
    const text = filteredAndSortedRows
      .map(
        (row) =>
          `${row.timestampExtracted} | ${row.workOrderNumber} | ${row.customerName || ""} | ${row.vendorName || ""} | ${row.serviceAddress || ""} | ${row.jobType || ""} | ${row.jobDescription || ""} | ${row.scheduledDate || ""} | ${row.amount || ""} | ${row.currency || ""} | ${row.notes || ""} | ${row.priority || ""} | ${row.calendarEventLink || ""} | ${row.workOrderPdfLink || ""}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy:", err);
      alert("Failed to copy to clipboard");
    }
  };

  const SortIcon = ({ field }: { field: keyof WorkOrder }) => {
    if (sortField !== field) {
      return (
        <svg
          className="w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
          />
        </svg>
      );
    }
    return sortDirection === "asc" ? (
      <svg
        className="w-4 h-4 text-blue-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 15l7-7 7 7"
        />
      </svg>
    ) : (
      <svg
        className="w-4 h-4 text-blue-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          Your extracted work orders
        </h2>
        <p className="text-sm text-gray-600 mb-6">
          {rows.length} work orders · 1 skipped · Last 30 days
        </p>

        {/* Search and actions */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by work order #, customer, vendor, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDownloadCSV}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={handleCopyToClipboard}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Copy to clipboard
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("timestampExtracted")}
                >
                  <div className="flex items-center gap-2">
                    timestamp_extracted
                    <SortIcon field="timestampExtracted" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("workOrderNumber")}
                >
                  <div className="flex items-center gap-2">
                    work_order_number
                    <SortIcon field="workOrderNumber" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("customerName")}
                >
                  <div className="flex items-center gap-2">
                    customer_name
                    <SortIcon field="customerName" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("vendorName")}
                >
                  <div className="flex items-center gap-2">
                    vendor_name
                    <SortIcon field="vendorName" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("serviceAddress")}
                >
                  <div className="flex items-center gap-2">
                    service_address
                    <SortIcon field="serviceAddress" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("jobType")}
                >
                  <div className="flex items-center gap-2">
                    job_type
                    <SortIcon field="jobType" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("jobDescription")}
                >
                  <div className="flex items-center gap-2">
                    job_description
                    <SortIcon field="jobDescription" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("scheduledDate")}
                >
                  <div className="flex items-center gap-2">
                    scheduled_date
                    <SortIcon field="scheduledDate" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("amount")}
                >
                  <div className="flex items-center gap-2">
                    amount
                    <SortIcon field="amount" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("currency")}
                >
                  <div className="flex items-center gap-2">
                    currency
                    <SortIcon field="currency" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("notes")}
                >
                  <div className="flex items-center gap-2">
                    notes
                    <SortIcon field="notes" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("priority")}
                >
                  <div className="flex items-center gap-2">
                    priority
                    <SortIcon field="priority" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("calendarEventLink")}
                >
                  <div className="flex items-center gap-2">
                    calendar_event_link
                    <SortIcon field="calendarEventLink" />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => handleSort("workOrderPdfLink")}
                >
                  <div className="flex items-center gap-2">
                    work_order_pdf_link
                    <SortIcon field="workOrderPdfLink" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAndSortedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-8 text-center text-sm text-gray-500"
                  >
                    No work orders found
                  </td>
                </tr>
              ) : (
                filteredAndSortedRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.timestampExtracted ? new Date(row.timestampExtracted).toLocaleString() : ""}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {row.workOrderNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.customerName || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.vendorName || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.serviceAddress || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.jobType || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                      {row.jobDescription || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.scheduledDate ? new Date(row.scheduledDate).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.amount || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.currency || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                      {row.notes || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.priority || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.calendarEventLink ? (
                        <a href={row.calendarEventLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          Link
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {row.workOrderPdfLink ? (
                        <a href={row.workOrderPdfLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          PDF
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
