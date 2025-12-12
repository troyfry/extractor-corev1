/**
 * Drizzle database client for Postgres.
 * 
 * This file creates a singleton database connection using Drizzle ORM.
 * It should only be used server-side (in API routes, server components, etc.).
 * 
 * Environment variable required:
 * - PG_CONNECTION_STRING: Postgres connection string (e.g., from Neon)
 *   Format: postgres://user:password@host:port/dbname
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Create a connection pool
// Using Pool instead of Client for better performance and connection management
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
});

// Create Drizzle instance with the pool and schema
export const db = drizzle(pool, { schema });

// Export the pool in case we need direct access (rare)
export { pool };

