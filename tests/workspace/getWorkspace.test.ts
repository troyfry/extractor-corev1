/**
 * Workspace Resolution Order Tests
 * 
 * Ensures workspace resolution follows correct priority:
 * 1. Cookies (fast, zero API calls)
 * 2. Users Sheet (source of truth, rehydrates cookies)
 * 3. Typed error (not silent undefined)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Next.js cookies
const mockCookies = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: (key: string) => {
      const value = mockCookies.get(key);
      return value ? { value } : undefined;
    },
  })),
}));

// Mock auth
vi.mock("@/lib/auth/currentUser", () => ({
  getCurrentUser: vi.fn(),
}));

// Mock Users Sheet
vi.mock("@/lib/onboarding/usersSheet", () => ({
  getUserRowById: vi.fn(),
}));

// Mock user settings
vi.mock("@/lib/userSettings/repository", () => ({
  getUserSpreadsheetId: vi.fn(),
}));

describe("workspace resolution order", () => {
  beforeEach(() => {
    mockCookies.clear();
    vi.clearAllMocks();
  });

  it("returns null when user is not authenticated", async () => {
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const { getCurrentUser } = await import("@/lib/auth/currentUser");

    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const result = await getWorkspace();
    expect(result).toBeNull();
  });

  it("prefers cookie spreadsheetId over Users sheet when cookie exists", async () => {
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const { getCurrentUser } = await import("@/lib/auth/currentUser");

    // Setup: Cookie has spreadsheetId
    mockCookies.set("googleSheetsSpreadsheetId", "cookie-spreadsheet-id");
    mockCookies.set("onboardingCompleted", "true");
    mockCookies.set("googleDriveFolderId", "cookie-folder-id");

    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
    } as any);

    const result = await getWorkspace();

    expect(result).not.toBeNull();
    expect(result?.source).toBe("cookie");
    expect(result?.workspace.spreadsheetId).toBe("cookie-spreadsheet-id");
    expect(result?.workspace.driveSignedFolderId).toBe("cookie-folder-id");
  });

  it("falls back to Users sheet when cookie is missing", async () => {
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const { getCurrentUser } = await import("@/lib/auth/currentUser");
    const { getUserSpreadsheetId } = await import("@/lib/userSettings/repository");
    const { getUserRowById } = await import("@/lib/onboarding/usersSheet");

    // Setup: No cookie, but Users sheet has data
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
      googleAccessToken: "token-123",
    } as any);

    vi.mocked(getUserSpreadsheetId).mockResolvedValue("session-spreadsheet-id");

    vi.mocked(getUserRowById).mockResolvedValue({
      spreadsheetId: "users-sheet-spreadsheet-id",
      mainSpreadsheetId: "users-sheet-main-id",
      onboardingCompleted: "TRUE",
      driveSignedFolderId: "users-folder-id",
    } as any);

    const result = await getWorkspace();

    expect(result).not.toBeNull();
    expect(result?.source).toBe("users_sheet");
    expect(result?.workspace.spreadsheetId).toBe("users-sheet-spreadsheet-id");
  });

  it("returns null (not undefined) when neither cookie nor Users sheet exists", async () => {
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const { getCurrentUser } = await import("@/lib/auth/currentUser");
    const { getUserSpreadsheetId } = await import("@/lib/userSettings/repository");

    // Setup: No cookie, no Users sheet data
    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
      googleAccessToken: "token-123",
    } as any);

    vi.mocked(getUserSpreadsheetId).mockResolvedValue(null);

    const result = await getWorkspace();

    // Should return null (typed), not undefined
    expect(result).toBeNull();
  });

  it("returns null when Users sheet exists but onboarding not completed", async () => {
    const { getWorkspace } = await import("@/lib/workspace/getWorkspace");
    const { getCurrentUser } = await import("@/lib/auth/currentUser");
    const { getUserSpreadsheetId } = await import("@/lib/userSettings/repository");
    const { getUserRowById } = await import("@/lib/onboarding/usersSheet");

    vi.mocked(getCurrentUser).mockResolvedValue({
      userId: "user-123",
      email: "test@example.com",
      googleAccessToken: "token-123",
    } as any);

    vi.mocked(getUserSpreadsheetId).mockResolvedValue("session-spreadsheet-id");

    vi.mocked(getUserRowById).mockResolvedValue({
      spreadsheetId: "users-sheet-spreadsheet-id",
      onboardingCompleted: "FALSE", // Not completed
    } as any);

    const result = await getWorkspace();

    expect(result).toBeNull();
  });
});

