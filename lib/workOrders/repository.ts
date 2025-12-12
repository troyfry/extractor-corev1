/**
 * Repository interface for work orders.
 * This abstraction allows us to swap implementations without changing
 * the rest of the application.
 * 
 * Architecture:
 * - WorkOrder is the UI/API shape (ISO date strings)
 * - Drizzle workOrders schema represents the DB shape (Date objects)
 * - Mappers handle the conversion between these shapes
 * - workOrderRepo is the single gateway for persistence
 */
import { db } from "@/db/client";
import { workOrders } from "@/db/schema";
import { desc, inArray, eq, and, isNull } from "drizzle-orm";
import type { WorkOrder, WorkOrderInput } from "./types";
import { dbToWorkOrder, inputToDbInsert } from "./mappers";

export interface WorkOrderRepository {
  /**
   * Save multiple work orders.
   * Generates id and createdAt if not provided.
   * userId is optional for free version.
   */
  saveMany(input: WorkOrderInput[]): Promise<WorkOrder[]>;

  /**
   * Get all work orders for a specific user (or null for free version).
   * @param userId - User ID to filter by (null for free version)
   * @param options - Optional query options (limit, etc.)
   */
  listForUser(userId: string | null, options?: { limit?: number }): Promise<WorkOrder[]>;

  /**
   * Get a work order by ID, but only if it belongs to the specified user.
   * @param userId - User ID to verify ownership (null for free version)
   * @param id - Work order ID
   */
  getByIdForUser(userId: string | null, id: string): Promise<WorkOrder | null>;

  /**
   * Find work orders by their work order numbers, scoped to a specific user.
   * Used for duplicate detection before inserting new work orders.
   * @param userId - User ID to filter by (null for free version)
   * @param numbers - Array of work order numbers to search for
   */
  findByWorkOrderNumbers(userId: string | null, numbers: string[]): Promise<WorkOrder[]>;

  /**
   * Clear all work orders for a specific user (useful for testing/reset).
   * @param userId - User ID to filter by (null for free version)
   */
  clearForUser(userId: string | null): Promise<void>;
}

/**
 * Drizzle/Postgres implementation of WorkOrderRepository.
 * 
 * This is the production implementation backed by a real Postgres database
 * (e.g., Neon) via Drizzle ORM.
 * All queries are user-scoped for security.
 */
class DrizzleWorkOrderRepository implements WorkOrderRepository {
  async saveMany(input: WorkOrderInput[]): Promise<WorkOrder[]> {
    // userId is optional for free version - no validation needed
    // Convert WorkOrderInput[] to DB insert format (dates as Date objects)
    const dbInserts = input.map(inputToDbInsert);

    // Insert into database and return the saved rows
    const savedRows = await db
      .insert(workOrders)
      .values(dbInserts)
      .returning();

    // Convert DB rows to WorkOrder[] (dates as ISO strings)
    return savedRows.map(dbToWorkOrder);
  }

  async listForUser(userId: string | null, options?: { limit?: number }): Promise<WorkOrder[]> {
    // Fetch work orders for the specified user (or null for free version), ordered by creation date (newest first)
    let query = db
      .select()
      .from(workOrders)
      .where(userId === null ? isNull(workOrders.userId) : eq(workOrders.userId, userId))
      .orderBy(desc(workOrders.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as any;
    }

    const rows = await query;

    // Convert DB rows to WorkOrder[] (dates as ISO strings)
    return rows.map(dbToWorkOrder);
  }

  async getByIdForUser(userId: string | null, id: string): Promise<WorkOrder | null> {
    // Fetch work order by ID, but only if it belongs to the specified user (or null for free version)
    const rows = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.id, id), userId === null ? isNull(workOrders.userId) : eq(workOrders.userId, userId)))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return dbToWorkOrder(rows[0]);
  }

  async findByWorkOrderNumbers(userId: string | null, numbers: string[]): Promise<WorkOrder[]> {
    if (numbers.length === 0) {
      return [];
    }

    // Query work orders where workOrderNumber is in the provided array AND belongs to the user (or null for free version)
    const rows = await db
      .select()
      .from(workOrders)
      .where(
        and(
          userId === null ? isNull(workOrders.userId) : eq(workOrders.userId, userId),
          inArray(workOrders.workOrderNumber, numbers)
        )
      );

    // Convert DB rows to WorkOrder[] (dates as ISO strings)
    return rows.map(dbToWorkOrder);
  }

  async clearForUser(userId: string | null): Promise<void> {
    // Delete all work orders for the specified user (or null for free version)
    await db
      .delete(workOrders)
      .where(userId === null ? isNull(workOrders.userId) : eq(workOrders.userId, userId));
  }
}

/**
 * In-memory implementation (kept for testing/development if needed).
 * This is no longer the default but can be useful for unit tests.
 */
class InMemoryWorkOrderRepository implements WorkOrderRepository {
  private store: WorkOrder[] = [];

  async saveMany(input: WorkOrderInput[]): Promise<WorkOrder[]> {
    const now = new Date().toISOString();
    const saved: WorkOrder[] = input.map((item) => ({
      id: item.id || crypto.randomUUID(),
      userId: item.userId ?? null,
      timestampExtracted: item.timestampExtracted || now,
      workOrderNumber: item.workOrderNumber,
      customerName: item.customerName ?? null,
      vendorName: item.vendorName ?? null,
      serviceAddress: item.serviceAddress ?? null,
      jobType: item.jobType ?? null,
      jobDescription: item.jobDescription ?? null,
      scheduledDate: item.scheduledDate ?? null,
      amount: item.amount ?? null,
      currency: item.currency ?? null,
      notes: item.notes ?? null,
      priority: item.priority ?? null,
      calendarEventLink: item.calendarEventLink ?? null,
      workOrderPdfLink: item.workOrderPdfLink ?? null,
      createdAt: item.createdAt || now,
    }));

    this.store.push(...saved);
    return saved;
  }

  async listForUser(userId: string | null, options?: { limit?: number }): Promise<WorkOrder[]> {
    let results = this.store.filter(
      (wo) => (userId === null && wo.userId === null) || (userId !== null && wo.userId === userId)
    );
    
    // Sort by createdAt descending (newest first)
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }
    
    return results;
  }

  async getByIdForUser(userId: string | null, id: string): Promise<WorkOrder | null> {
    const workOrder = this.store.find(
      (wo) => wo.id === id && ((userId === null && wo.userId === null) || (userId !== null && wo.userId === userId))
    );
    return workOrder || null;
  }

  async findByWorkOrderNumbers(userId: string | null, numbers: string[]): Promise<WorkOrder[]> {
    if (numbers.length === 0) {
      return [];
    }

    const numberSet = new Set(numbers);
    return this.store.filter(
      (wo) =>
        numberSet.has(wo.workOrderNumber) &&
        ((userId === null && wo.userId === null) || (userId !== null && wo.userId === userId))
    );
  }

  async clearForUser(userId: string | null): Promise<void> {
    this.store = this.store.filter(
      (wo) => !((userId === null && wo.userId === null) || (userId !== null && wo.userId === userId))
    );
  }
}

/**
 * Singleton repository instance.
 * 
 * Currently using DrizzleWorkOrderRepository (Postgres-backed).
 * To switch back to in-memory for testing, change this to:
 *   new InMemoryWorkOrderRepository()
 */
export const workOrderRepo: WorkOrderRepository =
  new DrizzleWorkOrderRepository();

