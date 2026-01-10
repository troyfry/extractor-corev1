// drizzle.config.ts
import { config } from "dotenv";
import { resolve } from "path";
import type { Config } from "drizzle-kit";

// Load .env.local first, then .env (Next.js convention)
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Please add it to your .env.local file.\n" +
    "Format: DATABASE_URL=postgresql://user:password@host/database?sslmode=require"
  );
}

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
