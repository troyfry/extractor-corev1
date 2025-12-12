/**
 * Drizzle configuration for Postgres database.
 * 
 * To install dependencies: pnpm install drizzle-orm drizzle-kit pg @types/pg
 * 
 * To generate migrations: pnpm db:generate
 * To push schema changes: pnpm db:push
 * To open Drizzle Studio: pnpm db:studio
 * 
 * Note: Make sure PG_CONNECTION_STRING is set in .env.local
 */
import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load environment variables from .env.local
dotenv.config({ path: ".env.local" });

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.PG_CONNECTION_STRING || "",
  },
} satisfies Config;

