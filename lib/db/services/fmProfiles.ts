// lib/db/services/fmProfiles.ts
import { db } from "@/lib/db/drizzle";
import { fm_profiles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface UpsertFmProfileInput {
  workspaceId: string;
  fmKey: string;
  displayName?: string | null;
  senderDomains?: string[] | null;
  senderEmails?: string[] | null;
  subjectKeywords?: string[] | null; // Note: not in DB schema yet - will be added in future migration
  woNumberRegion?: {
    page?: number;
    xPct?: number;
    yPct?: number;
    wPct?: number;
    hPct?: number;
    xPt?: number;
    yPt?: number;
    wPt?: number;
    hPt?: number;
    pageWidthPt?: number;
    pageHeightPt?: number;
    dpi?: number;
  } | null;
}

/**
 * Upsert an FM profile (create or update).
 * Uses unique constraint on (workspace_id, fm_key) for idempotency.
 */
export async function upsertFmProfile(
  input: UpsertFmProfileInput
): Promise<{ id: string; isNew: boolean }> {
  const {
    workspaceId,
    fmKey,
    displayName,
    senderDomains,
    senderEmails,
    subjectKeywords,
    woNumberRegion,
  } = input;

  const normalizedFmKey = fmKey.toLowerCase().trim();

  // Check if profile exists
  const existing = await db
    .select()
    .from(fm_profiles)
    .where(
      and(
        eq(fm_profiles.workspace_id, workspaceId),
        eq(fm_profiles.fm_key, normalizedFmKey)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing profile
    // Preserve wo_number_region if not explicitly provided (don't clear it)
    const updateData: {
      display_name?: string | null;
      sender_domains?: string[] | null;
      sender_emails?: string[] | null;
      wo_number_region?: any;
      updated_at: Date;
    } = {
      display_name: displayName !== undefined ? (displayName || null) : undefined,
      sender_domains: senderDomains !== undefined ? (senderDomains || null) : undefined,
      sender_emails: senderEmails !== undefined ? (senderEmails || null) : undefined,
      updated_at: new Date(),
    };

    // Only update wo_number_region if explicitly provided (not undefined)
    if (woNumberRegion !== undefined) {
      updateData.wo_number_region = woNumberRegion;
    }

    await db
      .update(fm_profiles)
      .set(updateData)
      .where(eq(fm_profiles.id, existing[0].id));

    return { id: existing[0].id, isNew: false };
  }

  // Create new profile
  const id = randomUUID();
  await db.insert(fm_profiles).values({
    id,
    workspace_id: workspaceId,
    fm_key: normalizedFmKey,
    display_name: displayName || normalizedFmKey,
    sender_domains: senderDomains || null,
    sender_emails: senderEmails || null,
    wo_number_region: woNumberRegion || null,
  });

  return { id, isNew: true };
}

/**
 * Get all FM profiles for a workspace.
 */
export async function listFmProfiles(workspaceId: string) {
  return await db
    .select()
    .from(fm_profiles)
    .where(eq(fm_profiles.workspace_id, workspaceId))
    .orderBy(fm_profiles.fm_key);
}

/**
 * Delete an FM profile by workspace ID and fm_key.
 */
export async function deleteFmProfile(
  workspaceId: string,
  fmKey: string
): Promise<boolean> {
  const normalizedFmKey = fmKey.toLowerCase().trim();
  
  const result = await db
    .delete(fm_profiles)
    .where(
      and(
        eq(fm_profiles.workspace_id, workspaceId),
        eq(fm_profiles.fm_key, normalizedFmKey)
      )
    )
    .returning({ id: fm_profiles.id });

  return result.length > 0;
}
