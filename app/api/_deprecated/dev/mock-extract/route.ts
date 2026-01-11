import { NextResponse } from "next/server";
import type { ManualProcessResponse } from "@/lib/workOrders/parsedTypes";

/**
 * Mock extraction endpoint for testing.
 * 
 * POST /api/dev/mock-extract
 * 
 * Returns mock work order data without actually processing a PDF.
 * Useful for testing UI and workflows.
 */
export async function POST() {
  const now = new Date().toISOString();
  const mockResponse: ManualProcessResponse = {
    workOrders: [
      {
        workOrderNumber: "TEST-123",
        customerName: "Acme Corp",
        vendorName: "Service Provider Inc",
        serviceAddress: "123 Main St, City, ST 12345",
        jobType: "Routine Maintenance",
        jobDescription: "Routine cleaning service and inspection",
        scheduledDate: "2025-01-15",
        amount: "250.00",
        currency: "USD",
        notes: "Mock test work order",
        priority: "Normal",
        timestampExtracted: now,
        fmKey: null, // Mock data
      },
      {
        workOrderNumber: "TEST-456",
        customerName: "Beta Industries",
        vendorName: "Service Provider Inc",
        serviceAddress: "456 Oak Ave, City, ST 67890",
        jobType: "Emergency Repair",
        jobDescription: "Urgent repair needed",
        scheduledDate: "2025-01-16",
        amount: "500.00",
        currency: "USD",
        notes: "Second mock work order for testing",
        priority: "High",
        timestampExtracted: now,
        fmKey: null, // Mock data
      },
    ],
    csv: `work_order_number,customer_name,vendor_name,service_address,job_type,job_description,scheduled_date,amount,currency,notes,priority
TEST-123,Acme Corp,Service Provider Inc,"123 Main St, City, ST 12345",Routine Maintenance,Routine cleaning service and inspection,2025-01-15,250.00,USD,Mock test work order,Normal
TEST-456,Beta Industries,Service Provider Inc,"456 Oak Ave, City, ST 67890",Emergency Repair,Urgent repair needed,2025-01-16,500.00,USD,Second mock work order for testing,High`,
    meta: {
      fileCount: 1,
      source: "manual",
      processedAt: now,
    },
  };

  return NextResponse.json(mockResponse);
}
