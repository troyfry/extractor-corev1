"use client";

import React from "react";

interface ProcessingStatusProps {
  total: number;
  processed: number;
  skipped: number;
  onDone: () => void;
}

interface ProcessingItem {
  subject: string;
  facility: string;
  status: "Processed" | "Skipped – PDF too large" | "Error";
}

export default function ProcessingStatus({
  total,
  processed,
  skipped,
  onDone,
}: ProcessingStatusProps) {
  const progress = total > 0 ? ((processed + skipped) / total) * 100 : 0;
  const isComplete = processed + skipped === total;

  // Mock processing items
  const items: ProcessingItem[] = [
    { subject: "WO-2024-001 - HVAC Maintenance", facility: "Acme Corp", status: "Processed" as const },
    { subject: "WO-2024-002 - Plumbing Repair", facility: "Tech Industries", status: "Processed" as const },
    { subject: "WO-2024-003 - Electrical Inspection", facility: "Global Systems", status: "Skipped – PDF too large" as const },
    { subject: "WO-2024-004 - Roof Repair", facility: "Acme Corp", status: "Processed" as const },
    { subject: "WO-2024-005 - Window Replacement", facility: "Design Studio", status: "Processed" as const },
  ].slice(0, Math.min(processed + skipped, 5));

  const getStatusColor = (status: ProcessingItem["status"]) => {
    switch (status) {
      case "Processed":
        return "text-green-600 bg-green-50";
      case "Skipped – PDF too large":
        return "text-yellow-600 bg-yellow-50";
      case "Error":
        return "text-red-600 bg-red-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">
        Processing your work orders...
      </h2>

      <div className="space-y-6">
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Processed {processed} of {total} · Skipped {skipped}
            </span>
            <span className="text-sm text-gray-500">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Processing items table */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Facility
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((item, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">{item.subject}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{item.facility}</td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                        item.status
                      )}`}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* View results button */}
        <div className="pt-4">
          <button
            type="button"
            onClick={onDone}
            disabled={!isComplete}
            className={`
              w-full px-6 py-3 font-medium rounded-lg transition-colors shadow-sm
              ${
                isComplete
                  ? "bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }
            `}
          >
            View results
          </button>
        </div>
      </div>
    </div>
  );
}

