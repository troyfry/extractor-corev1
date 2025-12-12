"use client";

import React, { useEffect, useState } from "react";
import type { WorkOrder } from "@/lib/workOrders/types";
import ResultsTable from "./ResultsTable";

export default function WorkOrdersList() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWorkOrders() {
      try {
        setLoading(true);
        const response = await fetch("/api/work-orders");
        
        if (!response.ok) {
          if (response.status === 401) {
            setError("Please sign in to view work orders");
            return;
          }
          throw new Error("Failed to fetch work orders");
        }

        const data = await response.json();
        setWorkOrders(data.workOrders || []);
      } catch (err) {
        console.error("Error fetching work orders:", err);
        setError(err instanceof Error ? err.message : "Failed to load work orders");
      } finally {
        setLoading(false);
      }
    }

    fetchWorkOrders();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          <p className="mt-4 text-sm text-gray-600">Loading work orders...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="text-center py-12">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <ResultsTable rows={workOrders} />;
}

