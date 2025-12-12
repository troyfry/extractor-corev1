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

/**
 * Simple hash function for IP addresses.
 * Not cryptographically secure, but sufficient for rate limiting.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
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

  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);      // YYYY-MM-DD
  const monthKey = now.toISOString().slice(0, 7);     // YYYY-MM

  try {
    // Check daily limit
    const dailyRecord = await db
      .select()
      .from(freeUsageDaily)
      .where(and(eq(freeUsageDaily.ipHash, ipHash), eq(freeUsageDaily.dayKey, dayKey)))
      .limit(1);
    
    const dailyCount = dailyRecord[0]?.count || 0;
    if (dailyCount >= MAX_PER_DAY) {
      return { allowed: false, reason: "daily" };
    }

    // Check monthly limit
    const monthlyRecord = await db
      .select()
      .from(freeUsageMonthly)
      .where(and(eq(freeUsageMonthly.ipHash, ipHash), eq(freeUsageMonthly.monthKey, monthKey)))
      .limit(1);
    
    const monthlyCount = monthlyRecord[0]?.count || 0;
    if (monthlyCount >= MAX_PER_MONTH) {
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

  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);      // YYYY-MM-DD
  const monthKey = now.toISOString().slice(0, 7);     // YYYY-MM

  console.log(`[incrementFreeUsage] Incrementing usage for IP hash: ${ipHash}, day: ${dayKey}, month: ${monthKey}`);

  try {
    // Use the pool directly for raw parameterized queries
    // This avoids Drizzle's SQL generation issues with ON CONFLICT
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Ensure constraints exist (idempotent - won't fail if they already exist)
      // Create unique constraint for daily table if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'free_usage_daily_pkey'
          ) THEN
            ALTER TABLE free_usage_daily ADD CONSTRAINT free_usage_daily_pkey PRIMARY KEY (ip_hash, day_key);
          END IF;
        END $$;
      `);
      
      // Create unique constraint for monthly table if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'free_usage_monthly_pkey'
          ) THEN
            ALTER TABLE free_usage_monthly ADD CONSTRAINT free_usage_monthly_pkey PRIMARY KEY (ip_hash, month_key);
          END IF;
        END $$;
      `);
      
      // Global table should already have primary key, but check anyway
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'free_usage_global_pkey'
          ) THEN
            ALTER TABLE free_usage_global ADD CONSTRAINT free_usage_global_pkey PRIMARY KEY (month_key);
          END IF;
        END $$;
      `);
      
      // Increment daily - use parameterized query with constraint name
      await client.query(
        `INSERT INTO free_usage_daily (ip_hash, day_key, count, updated_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT ON CONSTRAINT free_usage_daily_pkey
         DO UPDATE SET 
           count = free_usage_daily.count + 1,
           updated_at = NOW()`,
        [ipHash, dayKey]
      );
      console.log(`[incrementFreeUsage] Daily counter updated`);

      // Increment monthly
      await client.query(
        `INSERT INTO free_usage_monthly (ip_hash, month_key, count, updated_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT ON CONSTRAINT free_usage_monthly_pkey
         DO UPDATE SET 
           count = free_usage_monthly.count + 1,
           updated_at = NOW()`,
        [ipHash, monthKey]
      );
      console.log(`[incrementFreeUsage] Monthly counter updated`);

      // Increment global
      await client.query(
        `INSERT INTO free_usage_global (month_key, count, updated_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT ON CONSTRAINT free_usage_global_pkey
         DO UPDATE SET 
           count = free_usage_global.count + 1,
           updated_at = NOW()`,
        [monthKey]
      );
      console.log(`[incrementFreeUsage] Global counter updated`);
      
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
    // Re-throw the error so the caller knows it failed
    // The API route will catch it and log, but we want to see the full error
    throw error;
  }
}

