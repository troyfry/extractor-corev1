import { NextResponse } from "next/server";
import { db, pool } from "@/db/client";
import { freeUsageDaily, freeUsageMonthly, freeUsageGlobal } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Dev endpoint to reset free tier usage limits.
 * 
 * DELETE /api/dev/reset-limits?scope=all|daily|monthly|global&ip=<ipHash>
 * 
 * Examples:
 *   DELETE /api/dev/reset-limits?scope=all
 *   DELETE /api/dev/reset-limits?scope=daily&ip=<ipHash>
 *   DELETE /api/dev/reset-limits?scope=monthly&ip=<ipHash>
 *   DELETE /api/dev/reset-limits?scope=global
 * 
 * ⚠️ WARNING: This endpoint should ONLY be available in development.
 * In production, protect this route with additional authentication.
 */
export async function DELETE(request: Request) {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "This endpoint is not available in production" },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "all";
    const ipHash = searchParams.get("ip"); // Optional: specific IP hash to reset

    let deletedCount = 0;
    const results: Record<string, number> = {};

    if (scope === "all" || scope === "daily") {
      if (ipHash) {
        // Delete specific IP's daily records
        const result = await db
          .delete(freeUsageDaily)
          .where(eq(freeUsageDaily.ipHash, ipHash));
        results.daily = 1; // Drizzle doesn't return count, so we'll use raw SQL
      } else {
        // Delete all daily records
        const client = await pool.connect();
        try {
          const result = await client.query("DELETE FROM free_usage_daily");
          results.daily = result.rowCount || 0;
        } finally {
          client.release();
        }
      }
    }

    if (scope === "all" || scope === "monthly") {
      if (ipHash) {
        // Delete specific IP's monthly records
        const client = await pool.connect();
        try {
          const result = await client.query(
            "DELETE FROM free_usage_monthly WHERE ip_hash = $1",
            [ipHash]
          );
          results.monthly = result.rowCount || 0;
        } finally {
          client.release();
        }
      } else {
        // Delete all monthly records
        const client = await pool.connect();
        try {
          const result = await client.query("DELETE FROM free_usage_monthly");
          results.monthly = result.rowCount || 0;
        } finally {
          client.release();
        }
      }
    }

    if (scope === "all" || scope === "global") {
      // Delete all global records (no IP-specific option)
      const client = await pool.connect();
      try {
        const result = await client.query("DELETE FROM free_usage_global");
        results.global = result.rowCount || 0;
      } finally {
        client.release();
      }
    }

    return NextResponse.json({
      success: true,
      message: `Reset ${scope} limits`,
      deleted: results,
    });
  } catch (error) {
    console.error("[reset-limits] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to reset limits",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/dev/reset-limits
 * View current limit usage (for debugging).
 */
export async function GET(request: Request) {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "This endpoint is not available in production" },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const ipHash = searchParams.get("ip"); // Optional: filter by IP hash

    const client = await pool.connect();
    try {
      const now = new Date();
      const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const monthKey = now.toISOString().slice(0, 7); // YYYY-MM

      let dailyQuery = "SELECT ip_hash, day_key, count FROM free_usage_daily";
      let monthlyQuery = "SELECT ip_hash, month_key, count FROM free_usage_monthly";
      let globalQuery = "SELECT month_key, count FROM free_usage_global";

      const params: string[] = [];
      if (ipHash) {
        dailyQuery += " WHERE ip_hash = $1";
        monthlyQuery += " WHERE ip_hash = $1";
        params.push(ipHash);
      }

      const [dailyResult, monthlyResult, globalResult] = await Promise.all([
        client.query(dailyQuery, params.length > 0 ? params : undefined),
        client.query(monthlyQuery, params.length > 0 ? params : undefined),
        client.query(globalQuery),
      ]);

      return NextResponse.json({
        currentDay: dayKey,
        currentMonth: monthKey,
        daily: dailyResult.rows,
        monthly: monthlyResult.rows,
        global: globalResult.rows,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[reset-limits] Error viewing limits:", error);
    return NextResponse.json(
      {
        error: "Failed to view limits",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

