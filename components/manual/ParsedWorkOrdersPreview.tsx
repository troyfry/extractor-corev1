"use client";

import React from "react";
import type { ParsedWorkOrder } from "@/lib/workOrders/parsedTypes";

interface ParsedWorkOrdersPreviewProps {
  workOrders: ParsedWorkOrder[];
  onClear: () => void;
  onRemove?: (index: number) => void;
}

export default function ParsedWorkOrdersPreview({
  workOrders,
  onClear,
  onRemove,
}: ParsedWorkOrdersPreviewProps) {
  /**
   * Generate CSV from accumulated work orders.
   * This matches the server-side CSV generation format.
   */
  const generateCsv = (orders: ParsedWorkOrder[]): string => {
    const escapeCsvValue = (value: string | null | undefined): string => {
      if (value === null || value === undefined) {
        return "";
      }
      const str = String(value);
      if (str.includes('"') || str.includes(",") || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      "Work Order Number",
      "Scheduled Date",
      "Customer Name",
      "Service Address",
      "Job Type",
      "Job Description",
      "Amount",
      "Currency",
      "Priority",
      "Notes",
      "Vendor Name",
      "Timestamp Extracted",
    ];

    const rows = orders.map((wo) => [
      escapeCsvValue(wo.workOrderNumber),
      escapeCsvValue(wo.scheduledDate),
      escapeCsvValue(wo.customerName),
      escapeCsvValue(wo.serviceAddress),
      escapeCsvValue(wo.jobType),
      escapeCsvValue(wo.jobDescription),
      escapeCsvValue(wo.amount),
      escapeCsvValue(wo.currency),
      escapeCsvValue(wo.priority),
      escapeCsvValue(wo.notes),
      escapeCsvValue(wo.vendorName),
      escapeCsvValue(wo.timestampExtracted),
    ]);

    const csvLines = [
      headers.map(escapeCsvValue).join(","),
      ...rows.map((row) => row.join(",")),
    ];

    return csvLines.join("\n");
  };

  const handleDownloadCSV = () => {
    const csv = generateCsv(workOrders);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `work_orders_${timestamp}.csv`;
    
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  if (workOrders.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Parsed Work Orders ({workOrders.length})
        </h2>
        <div className="flex gap-3">
          <button
            onClick={handleDownloadCSV}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download CSV
          </button>
          <button
            onClick={onClear}
            className="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 font-medium text-sm"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700">
            <tr>
              {onRemove && (
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-12">
                  {/* Remove column header */}
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Work Order #
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Scheduled Date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Service Address
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Job Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Notes
              </th>
            </tr>
          </thead>
          <tbody className="bg-gray-800 divide-y divide-gray-700">
            {workOrders.map((wo, index) => (
              <tr key={index} className="hover:bg-gray-750">
                {onRemove && (
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onRemove(index)}
                      className="text-red-400 hover:text-red-300 transition-colors"
                      title="Remove this work order"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                )}
                <td className="px-4 py-3 text-sm font-medium text-white">
                  {wo.workOrderNumber}
                </td>
                <td className="px-4 py-3 text-sm text-gray-300">
                  {wo.scheduledDate
                    ? new Date(wo.scheduledDate).toLocaleDateString()
                    : "-"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-300">
                  {wo.customerName || "-"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-300 max-w-xs truncate">
                  {wo.serviceAddress || "-"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-300">
                  {wo.jobType || "-"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-300">
                  {wo.amount
                    ? `${wo.currency || "USD"} ${wo.amount}`
                    : "-"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-300 max-w-xs truncate">
                  {wo.notes || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

