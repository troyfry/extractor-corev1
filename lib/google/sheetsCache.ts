// lib/google/sheetsCache.ts
// Simple in-memory caches for Node runtime.
// NOTE: Per-server-instance only (good enough to cut quota).

type HeaderMap = {
  headers: string[];
  headersLower: string[];
  colLetterByLower: Record<string, string>;  // e.g. "jobid" -> "A"
  colIndexByLower: Record<string, number>;   // e.g. "jobid" -> 0
  fetchedAt: number;
};

const headerCache = new Map<string, HeaderMap>();
const ensuredCache = new Set<string>();

export function getHeaderCacheKey(spreadsheetId: string, sheetName: string) {
  return `${spreadsheetId}:${sheetName}`;
}

export function getEnsuredKey(spreadsheetId: string, sheetName: string) {
  return `${spreadsheetId}:${sheetName}`;
}

export function markEnsured(key: string) {
  ensuredCache.add(key);
}

export function isEnsured(key: string) {
  return ensuredCache.has(key);
}

export function getCachedHeaders(key: string) {
  return headerCache.get(key) || null;
}

export function setCachedHeaders(key: string, value: HeaderMap) {
  headerCache.set(key, value);
}

export function clearCachedHeaders(key: string) {
  headerCache.delete(key);
}

// Convert 0-based index -> A, B, ..., Z, AA...
export function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Get the column range (e.g., "A:M") for a given number of columns.
 * @param columnCount Number of columns (0-based, so pass array.length)
 * @returns Range string like "A:M" for 13 columns
 */
export function getColumnRange(columnCount: number): string {
  if (columnCount === 0) return "A:A";
  const lastIndex = columnCount - 1;
  const lastLetter = columnIndexToLetter(lastIndex);
  return `A:${lastLetter}`;
}

