// lib/readAdapter/guardrails.ts
import { getWorkspaceIdForUser } from "@/lib/db/utils/getWorkspaceId";
import { getPrimaryReadSource } from "@/lib/db/services/workspace";

/**
 * Check if DB primary reads are enabled via feature flag.
 */
function isDbPrimaryReadsEnabled(): boolean {
  return process.env.DB_PRIMARY_READS === "true" || process.env.DB_PRIMARY_READS === "1";
}

/**
 * Check if DB strict mode is enabled via feature flag.
 * In strict mode, no fallback to legacy is allowed.
 */
export function isDbStrictMode(): boolean {
  return process.env.DB_STRICT_MODE === "true" || process.env.DB_STRICT_MODE === "1";
}

/**
 * Check if DB is the primary read source for the current workspace.
 * Returns true if DB_PRIMARY_READS is ON and workspace primary_read_source is DB.
 */
export async function isDbPrimary(): Promise<boolean> {
  if (!isDbPrimaryReadsEnabled()) {
    return false;
  }

  try {
    const workspaceId = await getWorkspaceIdForUser();
    if (!workspaceId) {
      return false;
    }

    const primaryReadSource = await getPrimaryReadSource(workspaceId);
    return primaryReadSource === "DB";
  } catch (error) {
    console.error("[Guardrails] Error checking DB primary status:", error);
    return false;
  }
}

/**
 * Check if DB Native Mode is active (strict mode + DB primary).
 * In this mode, no legacy fallback is allowed.
 */
export async function isDbNativeMode(): Promise<boolean> {
  if (!isDbStrictMode()) {
    return false;
  }

  return await isDbPrimary();
}

/**
 * Check if legacy writes should be blocked.
 * Returns true if DB is primary (regardless of strict mode).
 */
export async function shouldBlockLegacyWrites(): Promise<boolean> {
  return await isDbPrimary();
}

/**
 * Log a warning if a legacy update endpoint is called while DB is primary.
 * In strict mode, this should be a hard error instead.
 */
export async function logLegacyUpdateWarning(endpoint: string, details?: Record<string, any>): Promise<void> {
  const isPrimary = await isDbPrimary();
  const strictMode = isDbStrictMode();
  
  if (isPrimary) {
    if (strictMode) {
      // In strict mode, this is an error, not just a warning
      console.error(`[Guard] Legacy update blocked in strict mode`, {
        endpoint,
        ...details,
      });
    } else {
      console.warn(`[Guard] Legacy update called while DB is primary — blocked or rerouted`, {
        endpoint,
        ...details,
      });
    }
  }
}
