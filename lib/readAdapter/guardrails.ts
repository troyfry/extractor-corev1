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
 * Log a warning if a legacy update endpoint is called while DB is primary.
 * This helps identify when updates should be routed to DB endpoints.
 */
export async function logLegacyUpdateWarning(endpoint: string, details?: Record<string, any>): Promise<void> {
  const isPrimary = await isDbPrimary();
  if (isPrimary) {
    console.warn(`[Guard] Legacy update called while DB is primary — blocked or rerouted`, {
      endpoint,
      ...details,
    });
  }
}
