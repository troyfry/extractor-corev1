/**
 * CSV export endpoint for work orders.
 * 
 * GET /api/work-orders/export
 *   Response: CSV file with work orders for the authenticated user
 * 
 * Returns a CSV file containing all work orders for the current user.
 * CSV is built server-side for security.
 */

import { getCurrentUser } from "@/lib/auth/currentUser";
import { workOrderRepo } from "@/lib/workOrders/repository";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Escape a value for CSV format.
 * Handles quotes, commas, and newlines.
 */
function escapeCsvValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  
  const str = String(value);
  // Escape quotes by doubling them, then wrap in quotes
  // Also handle newlines and commas
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

export async function GET() {
  try {
    // Require authentication
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    const userId = user.userId;

    // NOTE: Work orders are stored in Google Sheets, not DB
    // This endpoint should read from Google Sheets instead
    // For now, returning empty array as work orders are managed in Sheets
    const workOrders = await workOrderRepo.listForUser(userId);

    // Build CSV headers
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
      "Created At",
    ];

    // Build CSV rows
    const rows = workOrders.map((wo) => [
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
      escapeCsvValue(wo.createdAt),
    ]);

    // Combine headers and rows
    const csvLines = [
      headers.map(escapeCsvValue).join(","),
      ...rows.map((row) => row.join(",")),
    ];

    const csv = csvLines.join("\n");

    // Return CSV file
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="work_orders.csv"',
      },
    });
  } catch (error) {
    console.error("Error exporting work orders:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

