/**
 * Unit tests for Gmail processing utilities and normalization.
 * 
 * Tests:
 * - Work order number extraction from API responses
 * - Success message formatting
 * - Label name extraction
 */

import { describe, it, expect } from "vitest";

/**
 * Extract work order numbers from Gmail process API response.
 * This mirrors the logic in app/inbox/page.tsx
 */
function extractWorkOrderNumbers(response: any): string[] {
  return (response.workOrders || []).map((wo: any) => wo.workOrderNumber).filter(Boolean);
}

/**
 * Format success message data from Gmail process response.
 * This mirrors the logic in app/inbox/page.tsx
 */
function formatSuccessMessage(response: any, messageId: string) {
  const workOrderNumbers = extractWorkOrderNumbers(response);
  return {
    workOrders: response.workOrders?.length || 0,
    workOrderNumbers,
    labelRemoved: response.meta?.labelRemoved || false,
    messageId,
  };
}

/**
 * Aggregate batch processing results.
 * This mirrors the logic in app/inbox/page.tsx processBatch
 */
function aggregateBatchResults(results: Array<{ response: any; messageId: string }>) {
  let totalWorkOrders = 0;
  const allWorkOrderNumbers: string[] = [];
  let processedCount = 0;
  let labelRemovedCount = 0;

  for (const { response, messageId } of results) {
    if (response && response.workOrders) {
      const workOrderNumbers = extractWorkOrderNumbers(response);
      totalWorkOrders += response.workOrders.length || 0;
      allWorkOrderNumbers.push(...workOrderNumbers);
      processedCount++;
      if (response.meta?.labelRemoved) {
        labelRemovedCount++;
      }
    }
  }

  return {
    workOrders: totalWorkOrders,
    workOrderNumbers: allWorkOrderNumbers,
    processedCount,
    labelRemovedCount,
    totalMessages: results.length,
  };
}

describe("Gmail Processing Utilities", () => {
  describe("extractWorkOrderNumbers", () => {
    it("should extract work order numbers from valid response", () => {
      const response = {
        workOrders: [
          { workOrderNumber: "WO123" },
          { workOrderNumber: "WO456" },
          { workOrderNumber: "WO789" },
        ],
      };

      const result = extractWorkOrderNumbers(response);
      expect(result).toEqual(["WO123", "WO456", "WO789"]);
    });

    it("should filter out null/undefined work order numbers", () => {
      const response = {
        workOrders: [
          { workOrderNumber: "WO123" },
          { workOrderNumber: null },
          { workOrderNumber: undefined },
          { workOrderNumber: "" },
          { workOrderNumber: "WO456" },
        ],
      };

      const result = extractWorkOrderNumbers(response);
      expect(result).toEqual(["WO123", "WO456"]);
    });

    it("should handle empty work orders array", () => {
      const response = {
        workOrders: [],
      };

      const result = extractWorkOrderNumbers(response);
      expect(result).toEqual([]);
    });

    it("should handle missing workOrders field", () => {
      const response = {};

      const result = extractWorkOrderNumbers(response);
      expect(result).toEqual([]);
    });

    it("should handle work orders without workOrderNumber field", () => {
      const response = {
        workOrders: [
          { customerName: "Test Customer" },
          { workOrderNumber: "WO123" },
        ],
      };

      const result = extractWorkOrderNumbers(response);
      expect(result).toEqual(["WO123"]);
    });
  });

  describe("formatSuccessMessage", () => {
    it("should format success message with all details", () => {
      const response = {
        workOrders: [
          { workOrderNumber: "WO123" },
          { workOrderNumber: "WO456" },
        ],
        meta: {
          labelRemoved: true,
        },
      };
      const messageId = "msg123";

      const result = formatSuccessMessage(response, messageId);

      expect(result).toEqual({
        workOrders: 2,
        workOrderNumbers: ["WO123", "WO456"],
        labelRemoved: true,
        messageId: "msg123",
      });
    });

    it("should handle response without labelRemoved", () => {
      const response = {
        workOrders: [{ workOrderNumber: "WO123" }],
        meta: {},
      };
      const messageId = "msg123";

      const result = formatSuccessMessage(response, messageId);

      expect(result.labelRemoved).toBe(false);
      expect(result.workOrders).toBe(1);
    });

    it("should handle response without meta field", () => {
      const response = {
        workOrders: [{ workOrderNumber: "WO123" }],
      };
      const messageId = "msg123";

      const result = formatSuccessMessage(response, messageId);

      expect(result.labelRemoved).toBe(false);
      expect(result.workOrders).toBe(1);
    });

    it("should handle zero work orders", () => {
      const response = {
        workOrders: [],
        meta: {
          labelRemoved: false,
        },
      };
      const messageId = "msg123";

      const result = formatSuccessMessage(response, messageId);

      expect(result).toEqual({
        workOrders: 0,
        workOrderNumbers: [],
        labelRemoved: false,
        messageId: "msg123",
      });
    });
  });

  describe("aggregateBatchResults", () => {
    it("should aggregate multiple successful responses", () => {
      const results = [
        {
          response: {
            workOrders: [{ workOrderNumber: "WO123" }, { workOrderNumber: "WO456" }],
            meta: { labelRemoved: true },
          },
          messageId: "msg1",
        },
        {
          response: {
            workOrders: [{ workOrderNumber: "WO789" }],
            meta: { labelRemoved: false },
          },
          messageId: "msg2",
        },
        {
          response: {
            workOrders: [{ workOrderNumber: "WO101" }, { workOrderNumber: "WO202" }],
            meta: { labelRemoved: true },
          },
          messageId: "msg3",
        },
      ];

      const result = aggregateBatchResults(results);

      expect(result).toEqual({
        workOrders: 5,
        workOrderNumbers: ["WO123", "WO456", "WO789", "WO101", "WO202"],
        processedCount: 3,
        labelRemovedCount: 2,
        totalMessages: 3,
      });
    });

    it("should handle mixed success and failure", () => {
      const results = [
        {
          response: {
            workOrders: [{ workOrderNumber: "WO123" }],
            meta: { labelRemoved: true },
          },
          messageId: "msg1",
        },
        {
          response: null, // Failed response
          messageId: "msg2",
        },
        {
          response: {
            workOrders: [],
            meta: { labelRemoved: false },
          },
          messageId: "msg3",
        },
      ];

      const result = aggregateBatchResults(results);

      expect(result).toEqual({
        workOrders: 1,
        workOrderNumbers: ["WO123"],
        processedCount: 2, // msg1 and msg3 (even though msg3 has 0 work orders)
        labelRemovedCount: 1,
        totalMessages: 3,
      });
    });

    it("should handle empty results array", () => {
      const results: Array<{ response: any; messageId: string }> = [];

      const result = aggregateBatchResults(results);

      expect(result).toEqual({
        workOrders: 0,
        workOrderNumbers: [],
        processedCount: 0,
        labelRemovedCount: 0,
        totalMessages: 0,
      });
    });

    it("should handle all failed responses", () => {
      const results = [
        { response: null, messageId: "msg1" },
        { response: null, messageId: "msg2" },
      ];

      const result = aggregateBatchResults(results);

      expect(result).toEqual({
        workOrders: 0,
        workOrderNumbers: [],
        processedCount: 0,
        labelRemovedCount: 0,
        totalMessages: 2,
      });
    });

    it("should filter out invalid work order numbers", () => {
      const results = [
        {
          response: {
            workOrders: [
              { workOrderNumber: "WO123" },
              { workOrderNumber: null },
              { workOrderNumber: "" },
              { workOrderNumber: "WO456" },
            ],
            meta: { labelRemoved: true },
          },
          messageId: "msg1",
        },
      ];

      const result = aggregateBatchResults(results);

      expect(result.workOrderNumbers).toEqual(["WO123", "WO456"]);
      expect(result.workOrders).toBe(4); // Count includes invalid ones
    });
  });
});

