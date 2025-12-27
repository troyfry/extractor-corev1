import { createHash } from "crypto";

/**
 * Calculate SHA-256 hash of a buffer and return as hex string.
 * Used for file deduplication and tracking.
 * 
 * @param buffer - Buffer to hash (e.g., PDF file buffer)
 * @returns Hex string representation of the SHA-256 hash
 */
export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

