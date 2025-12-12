/**
 * Environment Configuration
 * 
 * Centralized environment variable checks and dev mode detection.
 */

/**
 * Check if the app is running in development mode.
 * 
 * In development: Returns true if NODE_ENV !== "production" OR NEXT_PUBLIC_DEV_MODE === "true"
 * In production: Returns true only if NEXT_PUBLIC_DEV_MODE === "true" (for testing)
 * 
 * To enable dev mode in production for testing, set in .env.local:
 * NEXT_PUBLIC_DEV_MODE=true
 */
export const isDevMode =
  process.env.NEXT_PUBLIC_DEV_MODE === "true" ||
  process.env.NODE_ENV !== "production";

