/**
 * FM Profile matching utilities.
 * 
 * Matches work orders to FM profiles based on sender domain and subject keywords.
 */

import type { FmProfile } from "./fmProfiles";

/**
 * Match an FM profile based on sender domain and subject keywords.
 * 
 * @param profiles Array of FM profiles to match against
 * @param senderEmail Email address of the sender (e.g., "sender@example.com")
 * @param subject Email subject line
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

  // Normalize subject for matching
  const normalizedSubject = subject.toLowerCase().trim();

  console.log(`[FM Profile Matching] Attempting to match profiles. Sender: "${senderEmail}", Subject: "${subject}"`);
  console.log(`[FM Profile Matching] Available profiles: ${profiles.map(p => `${p.fmKey} (senderDomains: "${p.senderDomains || ""}", subjectKeywords: "${p.subjectKeywords || ""}")`).join("; ")}`);

  // Try to match each profile
  for (const profile of profiles) {
    let matched = false;
    const matchReason: string[] = [];

    // Skip profiles that have no matching criteria defined
    const hasSenderDomains = profile.senderDomains && profile.senderDomains.trim().length > 0;
    const hasSubjectKeywords = profile.subjectKeywords && profile.subjectKeywords.trim().length > 0;
    
    if (!hasSenderDomains && !hasSubjectKeywords) {
      // Profile has no matching criteria - skip it (don't match by default)
      console.log(`[FM Profile Matching] Skipping profile "${profile.fmKey}" - no senderDomains or subjectKeywords defined`);
      continue;
    }

    // Check sender domain match
    if (hasSenderDomains && senderDomain) {
      const domains = profile.senderDomains!
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0);

      console.log(`[FM Profile Matching] Checking profile "${profile.fmKey}" sender domains: ${domains.join(", ")} against "${senderDomain}"`);

      for (const domain of domains) {
        // Extract domain from profile domain (handle email addresses)
        const profileDomainMatch = domain.match(/@?([^\s>]+)/);
        const profileDomain = profileDomainMatch ? profileDomainMatch[1].toLowerCase().trim() : domain;

        if (senderDomain === profileDomain || senderDomain.endsWith(`.${profileDomain}`)) {
          matched = true;
          matchReason.push(`sender domain "${senderDomain}" matches "${profileDomain}"`);
          console.log(`[FM Profile Matching] ✓ Matched profile "${profile.fmKey}" by sender domain: "${senderDomain}" matches "${profileDomain}"`);
          break;
        }
      }
    }

    // Check subject keyword match (if not already matched by domain)
    if (!matched && hasSubjectKeywords && normalizedSubject) {
      const keywords = profile.subjectKeywords!
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0);

      console.log(`[FM Profile Matching] Checking profile "${profile.fmKey}" subject keywords: ${keywords.join(", ")} against "${normalizedSubject}"`);

      for (const keyword of keywords) {
        if (normalizedSubject.includes(keyword)) {
          matched = true;
          matchReason.push(`subject contains keyword "${keyword}"`);
          console.log(`[FM Profile Matching] ✓ Matched profile "${profile.fmKey}" by subject keyword: "${keyword}" found in "${normalizedSubject}"`);
          break;
        }
      }
    }

    if (matched) {
      console.log(`[FM Profile Matching] ✓ FINAL MATCH: profile "${profile.fmKey}" for sender "${senderEmail}", subject "${subject}"`);
      console.log(`[FM Profile Matching] Match reason: ${matchReason.join(", ")}`);
      return profile;
    } else {
      console.log(`[FM Profile Matching] ✗ No match for profile "${profile.fmKey}"`);
    }
  }

  console.log(`[FM Profile Matching] ✗ No profile matched for sender "${senderEmail}", subject "${subject}"`);

  return null;
}

