/**
 * FM Profile matching utilities.
 * 
 * Matches work orders to FM profiles based on sender domain ONLY.
 * Subject keywords are no longer used to avoid conflicts when multiple profiles
 * share the same keywords (e.g., "WO#" appears in both superclean and 23rd_group).
 */

import type { FmProfile } from "./fmProfiles";

/**
 * Match an FM profile based on sender domain only.
 * 
 * @param profiles Array of FM profiles to match against
 * @param senderEmail Email address of the sender (e.g., "sender@example.com")
 * @param subject Email subject line (kept for logging, but not used for matching)
 * @returns Matching FM profile, or null if no match
 */
export function matchFmProfile(
  profiles: FmProfile[],
  senderEmail: string,
  subject: string
): FmProfile | null {
  if (!profiles || profiles.length === 0) {
    return null;
  }

  // Extract domain from sender email
  const emailMatch = senderEmail.match(/@([^\s>]+)/);
  const senderDomain = emailMatch ? emailMatch[1].toLowerCase().trim() : null;

  if (!senderDomain) {
    console.log(`[FM Profile Matching] No sender domain found in "${senderEmail}"`);
    return null;
  }

  console.log(`[FM Profile Matching] Attempting to match profiles by sender domain only. Sender: "${senderEmail}" (domain: "${senderDomain}")`);
  console.log(`[FM Profile Matching] Available profiles: ${profiles.map(p => `${p.fmKey} (senderDomains: "${p.senderDomains || ""}")`).join("; ")}`);

  // Try to match each profile by sender domain only
  for (const profile of profiles) {
    // Skip profiles that have no sender domains defined
    const hasSenderDomains = profile.senderDomains && profile.senderDomains.trim().length > 0;
    
    if (!hasSenderDomains) {
      // Profile has no sender domains - skip it (don't match by default)
      console.log(`[FM Profile Matching] Skipping profile "${profile.fmKey}" - no senderDomains defined`);
      continue;
    }

    // Check sender domain match
    const domains = profile.senderDomains!
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    console.log(`[FM Profile Matching] Checking profile "${profile.fmKey}" sender domains: ${domains.join(", ")} against "${senderDomain}"`);

    for (const domain of domains) {
      // Extract domain from profile domain (handle email addresses like "workorders@23rdgroup.com" or just "23rdgroup.com")
      let profileDomain: string;
      
      if (domain.includes("@")) {
        // It's an email address, extract the domain part
        const emailMatch = domain.match(/@([^\s>]+)/);
        profileDomain = emailMatch ? emailMatch[1].toLowerCase().trim() : domain.toLowerCase().trim();
      } else {
        // It's already a domain
        profileDomain = domain.toLowerCase().trim();
      }

      console.log(`[FM Profile Matching] Comparing: senderDomain="${senderDomain}" vs profileDomain="${profileDomain}"`);

      // Check for exact match
      if (senderDomain === profileDomain) {
        console.log(`[FM Profile Matching] ✓ FINAL MATCH (exact): profile "${profile.fmKey}" for sender "${senderEmail}" (domain: "${senderDomain}" matches "${profileDomain}")`);
        return profile;
      }

      // Check if senderDomain is a subdomain of profileDomain (e.g., "mail.gosuperclean.com" matches "gosuperclean.com")
      if (senderDomain.endsWith(`.${profileDomain}`)) {
        console.log(`[FM Profile Matching] ✓ FINAL MATCH (subdomain): profile "${profile.fmKey}" for sender "${senderEmail}" (domain: "${senderDomain}" ends with ".${profileDomain}")`);
        return profile;
      }

      // Check if profileDomain is a subdomain of senderDomain (reverse case)
      if (profileDomain.endsWith(`.${senderDomain}`)) {
        console.log(`[FM Profile Matching] ✓ FINAL MATCH (reverse subdomain): profile "${profile.fmKey}" for sender "${senderEmail}" (domain: "${profileDomain}" ends with ".${senderDomain}")`);
        return profile;
      }

      // Check if senderDomain starts with profileDomain (handles missing TLD, e.g., "gosuperclean" matches "gosuperclean.com")
      // This handles cases where senderDomains might be missing the TLD
      if (senderDomain.startsWith(`${profileDomain}.`) || senderDomain === profileDomain) {
        console.log(`[FM Profile Matching] ✓ FINAL MATCH (base domain): profile "${profile.fmKey}" for sender "${senderEmail}" (domain: "${senderDomain}" starts with "${profileDomain}.")`);
        return profile;
      }

      // Check if profileDomain starts with senderDomain (reverse case)
      if (profileDomain.startsWith(`${senderDomain}.`) || profileDomain === senderDomain) {
        console.log(`[FM Profile Matching] ✓ FINAL MATCH (reverse base domain): profile "${profile.fmKey}" for sender "${senderEmail}" (domain: "${profileDomain}" starts with "${senderDomain}.")`);
        return profile;
      }
    }

    console.log(`[FM Profile Matching] ✗ No match for profile "${profile.fmKey}"`);
  }

  console.log(`[FM Profile Matching] ✗ No profile matched for sender "${senderEmail}" (domain: "${senderDomain}")`);

  return null;
}

