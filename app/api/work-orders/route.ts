/**
 * API routes for work orders.
 * 
 * POST /api/work-orders
 *   Body: { workOrders: WorkOrderInput[] }
 *   Response: { workOrders: WorkOrder[] }
 *   Note: userId is automatically attached from session
 * 
 * GET /api/work-orders
 *   Response: { workOrders: WorkOrder[] }
 *   Note: Returns only work orders for the authenticated user
 * 
 * DELETE /api/work-orders
 *   Response: { success: true }
 *   Note: Deletes only work orders for the authenticated user
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { workOrderRepo } from "@/lib/workOrders/repository";
import type { WorkOrderInput } from "@/lib/workOrders/types";

/**
 * Validate that a work order input has all required fields.
 */
function validateWorkOrderInput(input: unknown): input is WorkOrderInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const wo = input as Record<string, unknown>;

  // Only workOrderNumber is required
  return typeof wo.workOrderNumber === "string";
}

/**
 * POST /api/work-orders
 * Create/save multiple work orders.
 * Automatically attaches userId from session (optional for free version).
 */
export async function POST(req: Request) {
  try {
    // Require authentication for Pro tier
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = user.userId;

    // Check if database connection is configured
    if (!process.env.PG_CONNECTION_STRING) {
      console.error("PG_CONNECTION_STRING is not set");
      return NextResponse.json(
        { 
          error: "Database not configured. Please set PG_CONNECTION_STRING in .env.local" 
        },
        { status: 500 }
      );
    }

    const body = await req.json();

    // Validate request body
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.workOrders)) {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 }
      );
    }

    // Validate each work order
    for (const wo of body.workOrders) {
      if (!validateWorkOrderInput(wo)) {
        return NextResponse.json(
          { error: "Invalid payload" },
          { status: 400 }
        );
      }
    }

    // Attach userId to all work orders (optional for free version)
    const workOrdersWithUserId = body.workOrders.map((wo: WorkOrderInput) => ({
      ...wo,
      userId: wo.userId ?? userId ?? null,
    }));

    // Save work orders
    const saved = await workOrderRepo.saveMany(workOrdersWithUserId);

    return NextResponse.json({ workOrders: saved }, { status: 200 });
  } catch (error) {
    console.error("Error saving work orders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/work-orders
 * Get all work orders for the authenticated user (or null for free version).
 */
export async function GET() {
  try {
    // Require authentication for Pro tier
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = user.userId;

    // Check if database connection is configured
    if (!process.env.PG_CONNECTION_STRING) {
      console.error("PG_CONNECTION_STRING is not set");
      return NextResponse.json(
        { 
          error: "Database not configured. Please set PG_CONNECTION_STRING in .env.local" 
        },
        { status: 500 }
      );
    }

    const workOrders = await workOrderRepo.listForUser(userId);
    return NextResponse.json({ workOrders }, { status: 200 });
  } catch (error) {
    console.error("Error fetching work orders:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/work-orders
 * Clear all work orders for the authenticated user (or null for free version).
 */
export async function DELETE() {
  try {
    // Require authentication for Pro tier
    const user = await getCurrentUser();
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = user.userId;

    await workOrderRepo.clearForUser(userId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error clearing work orders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

