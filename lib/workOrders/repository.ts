/**
 * Repository interface for work orders.
 * 
 * NOTE: Work orders are stored in Google Sheets, not a database.
 * This repository interface is kept for compatibility but implementations
 * are stubs that return empty results. All work order persistence happens
 * via Google Sheets helpers (lib/google/sheets.ts, lib/workOrders/sheetsIngestion.ts).
 */

import type { WorkOrder, WorkOrderInput } from "./types";
import { randomUUID } from "crypto";

export interface WorkOrderRepository {
  /**
   * Save multiple work orders.
   * NOTE: This is a stub - work orders are stored in Google Sheets, not DB.
   */
  saveMany(input: WorkOrderInput[]): Promise<WorkOrder[]>;

  /**
   * Get all work orders for a specific user.
   * NOTE: This is a stub - work orders are read from Google Sheets, not DB.
   */
  listForUser(userId: string | null, options?: { limit?: number }): Promise<WorkOrder[]>;

  /**
   * Get a work order by ID.
   * NOTE: This is a stub - work orders are read from Google Sheets, not DB.
   */
  getByIdForUser(userId: string | null, id: string): Promise<WorkOrder | null>;

  /**
   * Find work orders by their work order numbers.
   * NOTE: This is a stub - duplicate checking should be done via Google Sheets.
   */
  findByWorkOrderNumbers(userId: string | null, numbers: string[]): Promise<WorkOrder[]>;

  /**
   * Find work order by jobId (stable UUID).
   * NOTE: This is a stub - work orders are read from Google Sheets, not DB.
   */
  findByJobId(jobId: string): Promise<WorkOrder | null>;

  /**
   * Clear all work orders for a specific user.
   * NOTE: This is a stub - work orders are managed in Google Sheets.
   */
  clearForUser(userId: string | null): Promise<void>;
}

/**
 * Stub implementation - work orders are stored in Google Sheets.
 * This exists only for backward compatibility with code that imports workOrderRepo.
 */
class StubWorkOrderRepository implements WorkOrderRepository {
  async saveMany(input: WorkOrderInput[]): Promise<WorkOrder[]> {
    // Work orders are stored in Google Sheets, not DB
    // Return empty array - actual persistence happens via Sheets helpers
    console.warn("[workOrderRepo] saveMany() called but work orders are stored in Google Sheets");
    return [];
  }

  async listForUser(userId: string | null, options?: { limit?: number }): Promise<WorkOrder[]> {
    // Work orders are read from Google Sheets, not DB
    console.warn("[workOrderRepo] listForUser() called but work orders are read from Google Sheets");
    return [];
  }

  async getByIdForUser(userId: string | null, id: string): Promise<WorkOrder | null> {
    // Work orders are read from Google Sheets, not DB
    console.warn("[workOrderRepo] getByIdForUser() called but work orders are read from Google Sheets");
    return null;
  }

  async findByWorkOrderNumbers(userId: string | null, numbers: string[]): Promise<WorkOrder[]> {
    // Duplicate checking should be done via Google Sheets
    console.warn("[workOrderRepo] findByWorkOrderNumbers() called but duplicate checking should use Google Sheets");
    return [];
  }

  async findByJobId(jobId: string): Promise<WorkOrder | null> {
    // Work orders are read from Google Sheets, not DB
    console.warn("[workOrderRepo] findByJobId() called but work orders are read from Google Sheets");
    return null;
  }

  async clearForUser(userId: string | null): Promise<void> {
    // Work orders are managed in Google Sheets
    console.warn("[workOrderRepo] clearForUser() called but work orders are managed in Google Sheets");
  }
}

/**
 * Singleton repository instance.
 * 
 * NOTE: This is a stub implementation. Work orders are stored in Google Sheets.
 */
export const workOrderRepo: WorkOrderRepository = new StubWorkOrderRepository();
