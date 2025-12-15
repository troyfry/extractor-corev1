import { NextResponse } from "next/server";
import { pool } from "@/db/client";

/**
 * Dev endpoint to test database connection and usage tables.
 * 
 * GET /api/dev/test-usage-db
 * 
 * Tests:
 * 1. Database connection
 * 2. Table existence
 * 3. Can read/write to tables
 */
export async function GET() {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "This endpoint is not available in production" },
      { status: 403 }
    );
  }

  const results: Record<string, any> = {
    connectionStringPresent: !!process.env.PG_CONNECTION_STRING,
    connectionStringPreview: process.env.PG_CONNECTION_STRING
      ? `${process.env.PG_CONNECTION_STRING.substring(0, 20)}...`
      : "NOT SET",
  };

  try {
    const client = await pool.connect();
    try {
      // Test connection
      await client.query("SELECT 1");
      results.connection = "OK";

      // Check if tables exist
      const tableCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('free_usage_daily', 'free_usage_monthly', 'free_usage_global')
        ORDER BY table_name;
      `);
      results.tablesExist = tableCheck.rows.map((r: any) => r.table_name);

      // Try to read from tables
      const dailyCount = await client.query("SELECT COUNT(*) as count FROM free_usage_daily");
      const monthlyCount = await client.query("SELECT COUNT(*) as count FROM free_usage_monthly");
      const globalCount = await client.query("SELECT COUNT(*) as count FROM free_usage_global");

      results.tableRowCounts = {
        daily: parseInt(dailyCount.rows[0]?.count || "0"),
        monthly: parseInt(monthlyCount.rows[0]?.count || "0"),
        global: parseInt(globalCount.rows[0]?.count || "0"),
      };

      // Try a test write
      const now = new Date();
      const testDayKey = now.toISOString().slice(0, 10);
      const testMonthKey = now.toISOString().slice(0, 7);
      const testIpHash = "test";

      await client.query("BEGIN");
      try {
        await client.query(`
          INSERT INTO free_usage_daily (ip_hash, day_key, count, updated_at)
          VALUES ($1, $2, 1, NOW())
          ON CONFLICT (ip_hash, day_key)
          DO UPDATE SET count = free_usage_daily.count + 1, updated_at = NOW()
        `, [testIpHash, testDayKey]);

        const verify = await client.query(
          "SELECT count FROM free_usage_daily WHERE ip_hash = $1 AND day_key = $2",
          [testIpHash, testDayKey]
        );
        results.testWrite = {
          success: true,
          count: verify.rows[0]?.count || 0,
        };
        await client.query("COMMIT");
      } catch (writeError) {
        await client.query("ROLLBACK");
        results.testWrite = {
          success: false,
          error: writeError instanceof Error ? writeError.message : String(writeError),
        };
      }

      results.status = "SUCCESS";
    } finally {
      client.release();
    }
  } catch (error) {
    results.status = "ERROR";
    results.error = error instanceof Error ? error.message : String(error);
    results.errorStack = error instanceof Error ? error.stack : undefined;
  }

  return NextResponse.json(results, { status: 200 });
}

