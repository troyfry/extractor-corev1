/**
 * Unit tests for Gmail label name extraction and display.
 * 
 * Tests the logic for extracting and displaying label names
 * from Gmail list API responses.
 */

import { describe, it, expect } from "vitest";

/**
 * Extract label name from Gmail list API response.
 * This mirrors the logic in app/inbox/page.tsx
 */
function extractLabelName(response: any): string {
  return response.labelName || "Gmail Inbox";
}

/**
 * Format label name for display.
 * Handles edge cases like empty strings, null, undefined.
 */
function formatLabelNameForDisplay(labelName: string | null | undefined): string {
  if (!labelName) {
    return "Gmail Inbox";
  }
  const trimmed = labelName.trim();
  if (trimmed === "") {
    return "Gmail Inbox";
  }
  return trimmed;
}

describe("Gmail Label Name Extraction", () => {
  describe("extractLabelName", () => {
    it("should extract label name from response", () => {
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: "Work Orders/To Process",
      };

      const result = extractLabelName(response);
      expect(result).toBe("Work Orders/To Process");
    });

    it("should return default when labelName is missing", () => {
      const response = {
        emails: [],
        nextPageToken: null,
      };

      const result = extractLabelName(response);
      expect(result).toBe("Gmail Inbox");
    });

    it("should return default when labelName is null", () => {
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: null,
      };

      const result = extractLabelName(response);
      expect(result).toBe("Gmail Inbox");
    });

    it("should return default when labelName is undefined", () => {
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: undefined,
      };

      const result = extractLabelName(response);
      expect(result).toBe("Gmail Inbox");
    });

    it("should handle nested label names", () => {
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: "Work Orders/Signed To Match",
      };

      const result = extractLabelName(response);
      expect(result).toBe("Work Orders/Signed To Match");
    });

    it("should handle label names with special characters", () => {
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: "Work Orders (Priority)",
      };

      const result = extractLabelName(response);
      expect(result).toBe("Work Orders (Priority)");
    });
  });

  describe("formatLabelNameForDisplay", () => {
    it("should return label name as-is when valid", () => {
      expect(formatLabelNameForDisplay("Work Orders/To Process")).toBe("Work Orders/To Process");
      expect(formatLabelNameForDisplay("INBOX")).toBe("INBOX");
      expect(formatLabelNameForDisplay("Custom Label")).toBe("Custom Label");
    });

    it("should return default for empty string", () => {
      expect(formatLabelNameForDisplay("")).toBe("Gmail Inbox");
      expect(formatLabelNameForDisplay("   ")).toBe("Gmail Inbox");
    });

    it("should return default for null", () => {
      expect(formatLabelNameForDisplay(null)).toBe("Gmail Inbox");
    });

    it("should return default for undefined", () => {
      expect(formatLabelNameForDisplay(undefined)).toBe("Gmail Inbox");
    });

    it("should trim whitespace", () => {
      expect(formatLabelNameForDisplay("  Work Orders  ")).toBe("Work Orders");
    });

    it("should handle empty string after trim", () => {
      expect(formatLabelNameForDisplay("   ")).toBe("Gmail Inbox");
    });
  });

  describe("Label name integration scenarios", () => {
    it("should handle workspace queue label", () => {
      // Simulating what the API returns when using workspace queue label
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: "Work Orders/To Process", // From workspace.labels.queue.name
      };

      const labelName = extractLabelName(response);
      const displayName = formatLabelNameForDisplay(labelName);

      expect(displayName).toBe("Work Orders/To Process");
    });

    it("should handle legacy workspace label", () => {
      // Simulating what the API returns when using legacy label
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: "Work Orders", // From workspace.gmailWorkOrdersLabelName
      };

      const labelName = extractLabelName(response);
      const displayName = formatLabelNameForDisplay(labelName);

      expect(displayName).toBe("Work Orders");
    });

    it("should handle query param label", () => {
      // Simulating what the API returns when label is provided via query param
      const response = {
        emails: [],
        nextPageToken: null,
        labelName: "Custom Label", // From query param
      };

      const labelName = extractLabelName(response);
      const displayName = formatLabelNameForDisplay(labelName);

      expect(displayName).toBe("Custom Label");
    });

    it("should handle missing label gracefully", () => {
      // Simulating what the API returns when no label is configured
      const response = {
        emails: [],
        nextPageToken: null,
        // labelName is missing
      };

      const labelName = extractLabelName(response);
      const displayName = formatLabelNameForDisplay(labelName);

      expect(displayName).toBe("Gmail Inbox");
    });
  });
});

