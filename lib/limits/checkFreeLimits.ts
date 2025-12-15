/**
 * Free tier rate limiting.
 * 
 * Implements three layers of protection:
 * 1. Per-IP daily limit (main gate)
 * 2. Per-IP monthly limit (backup)
 * 3. Global monthly budget cap (safety fuse)
 * 
 * This prevents anonymous users from burning through server-side OpenAI tokens.
 */

import { db, pool } from "@/db/client";
import { freeUsageDaily, freeUsageMonthly, freeUsageGlobal } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

const MAX_PER_DAY = 10;
const MAX_PER_MONTH = 20;
const FREE_GLOBAL_MAX_DOCS_PER_MONTH = 1000;

// Stricter limits for "unknown" IPs (when IP cannot be determined)
const MAX_PER_DAY_UNKNOWN = 3;
const MAX_PER_MONTH_UNKNOWN = 5;

// Module-level guard to ensure tables are created only once per server instance
let tablesEnsured = false;

/**
 * Get current date/time keys in America/New_York timezone.
 * Returns dayKey (YYYY-MM-DD) and monthKey (YYYY-MM) based on Eastern Time.
 */
function getTimeKeys(): { dayKey: string; monthKey: string } {
  // Format date in America/New_York timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(p => p.type === "year")?.value || "";
  const month = parts.find(p => p.type === "month")?.value || "";
  const day = parts.find(p => p.type === "day")?.value || "";
  
  const dayKey = `${year}-${month}-${day}`;
  const monthKey = `${year}-${month}`;
  
  return { dayKey, monthKey };
}

/**
 * Ensure tables exist (best-effort, runs once per server instance).
 * Uses module-level boolean guard to prevent redundant CREATE TABLE calls.
 */
async function ensureTablesOnce(): Promise<void> {
  if (tablesEnsured) {
    return; // Already ensured in this server instance
  }

  try {
    const client = await pool.connect();
    try {
      // Create tables if they don't exist (PRIMARY KEY included in CREATE TABLE)
      await client.query(`
        CREATE TABLE IF NOT EXISTS free_usage_daily (
          ip_hash VARCHAR(255) NOT NULL,
          day_key VARCHAR(10) NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (ip_hash, day_key)
        );
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS free_usage_monthly (
          ip_hash VARCHAR(255) NOT NULL,
          month_key VARCHAR(7) NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          PRIMARY KEY (ip_hash, month_key)
        );
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS free_usage_global (
          month_key VARCHAR(7) NOT NULL PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
      
      tablesEnsured = true;
    } finally {
      client.release();
    }
  } catch (error) {
    // Best-effort: if table creation fails, log but don't block
    // Tables may already exist, or there may be a transient DB issue
    console.warn("[ensureTablesOnce] Failed to ensure tables (non-fatal):", error);
    // Don't set tablesEnsured = true on error, so we'll retry next time
  }
}

/**
 * Simple hash function for IP addresses.
 * djb2-style variant using XOR for lower collision rate.
 * Not cryptographically secure, but sufficient for rate limiting.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export type LimitCheckResult = {
  allowed: boolean;
  reason?: "daily" | "monthly" | "global";
};

/**
 * Check if a request is allowed under free tier limits.
 * This only checks limits, does NOT increment counters.
 * 
 * @param ip - Client IP address (from x-forwarded-for header)
 * @returns LimitCheckResult with allowed status and reason if blocked
 */
export async function checkFreeLimits(params: { ip?: string }): Promise<LimitCheckResult> {
  const ip = params.ip ?? "unknown";
  const ipHash = simpleHash(ip);

  // Use stricter limits for "unknown" IPs (when IP cannot be determined)
  const isUnknown = ip === "unknown";
  const maxDaily = isUnknown ? MAX_PER_DAY_UNKNOWN : MAX_PER_DAY;
  const maxMonthly = isUnknown ? MAX_PER_MONTH_UNKNOWN : MAX_PER_MONTH;

  // Get time keys in America/New_York timezone
  const { dayKey, monthKey } = getTimeKeys();

  try {
    // Ensure tables exist (best-effort, runs once per server instance)
    await ensureTablesOnce();

    // Check daily limit
    const dailyRecord = await db
      .select()
      .from(freeUsageDaily)
      .where(and(eq(freeUsageDaily.ipHash, ipHash), eq(freeUsageDaily.dayKey, dayKey)))
      .limit(1);
    
    const dailyCount = dailyRecord[0]?.count || 0;
    if (dailyCount >= maxDaily) {
      return { allowed: false, reason: "daily" };
    }

    // Check monthly limit
    const monthlyRecord = await db
      .select()
      .from(freeUsageMonthly)
      .where(and(eq(freeUsageMonthly.ipHash, ipHash), eq(freeUsageMonthly.monthKey, monthKey)))
      .limit(1);
    
    const monthlyCount = monthlyRecord[0]?.count || 0;
    if (monthlyCount >= maxMonthly) {
      return { allowed: false, reason: "monthly" };
    }

    // Check global limit
    const globalRecord = await db
      .select()
      .from(freeUsageGlobal)
      .where(eq(freeUsageGlobal.monthKey, monthKey))
      .limit(1);
    
    const globalCount = globalRecord[0]?.count || 0;
    if (globalCount >= FREE_GLOBAL_MAX_DOCS_PER_MONTH) {
      return { allowed: false, reason: "global" };
    }

    return { allowed: true };
  } catch (error) {
    console.error("Error checking free limits:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    // On error, allow the request (fail open) but log it
    // In production, you might want to fail closed instead
    return { allowed: true };
  }
}

/**
 * Increment free tier usage counters after successful processing.
 * This should be called AFTER a request has been successfully processed.
 * 
 * @param ip - Client IP address (from x-forwarded-for header)
 */
export async function incrementFreeUsage(params: { ip?: string }): Promise<void> {
  const ip = params.ip ?? "unknown";
  const ipHash = simpleHash(ip);

  // Get time keys in America/New_York timezone
  const { dayKey, monthKey } = getTimeKeys();

  console.log(`[incrementFreeUsage] Incrementing usage for IP hash: ${ipHash}, day: ${dayKey}, month: ${monthKey}`);

  try {
    // Ensure tables exist (best-effort, runs once per server instance)
    await ensureTablesOnce();

    // Use the pool directly for raw parameterized queries
    // This avoids Drizzle's SQL generation issues with ON CONFLICT
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      console.log(`[incrementFreeUsage] Transaction started`);
      
      // Increment daily - use ON CONFLICT with column names (works with PRIMARY KEY)
      console.log(`[incrementFreeUsage] Inserting/updating daily counter: ipHash=${ipHash}, dayKey=${dayKey}`);
      const dailyResult = await client.query(
        `INSERT INTO free_usage_daily (ip_hash, day_key, count, updated_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (ip_hash, day_key)
         DO UPDATE SET 
           count = free_usage_daily.count + 1,
           updated_at = NOW()`,
        [ipHash, dayKey]
      );
      console.log(`[incrementFreeUsage] Daily counter updated (rows affected: ${dailyResult.rowCount})`);

      // Increment monthly
      console.log(`[incrementFreeUsage] Inserting/updating monthly counter: ipHash=${ipHash}, monthKey=${monthKey}`);
      const monthlyResult = await client.query(
        `INSERT INTO free_usage_monthly (ip_hash, month_key, count, updated_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (ip_hash, month_key)
         DO UPDATE SET 
           count = free_usage_monthly.count + 1,
           updated_at = NOW()`,
        [ipHash, monthKey]
      );
      console.log(`[incrementFreeUsage] Monthly counter updated (rows affected: ${monthlyResult.rowCount})`);

      // Increment global
      console.log(`[incrementFreeUsage] Inserting/updating global counter: monthKey=${monthKey}`);
      const globalResult = await client.query(
        `INSERT INTO free_usage_global (month_key, count, updated_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (month_key)
         DO UPDATE SET 
           count = free_usage_global.count + 1,
           updated_at = NOW()`,
        [monthKey]
      );
      console.log(`[incrementFreeUsage] Global counter updated (rows affected: ${globalResult.rowCount})`);
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    console.log(`[incrementFreeUsage] Successfully incremented all counters`);
  } catch (error) {
    console.error("[incrementFreeUsage] Error incrementing free usage:", error);
    if (error instanceof Error) {
      console.error("[incrementFreeUsage] Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    // Re-throw the error so the caller knows it failed
    // The API route will catch it and log, but we want to see the full error
    throw error;
  }
}

