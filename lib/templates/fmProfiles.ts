/**
 * FM Profile types and utilities.
 * 
 * FM Profiles define OCR zones for Facility Management platforms.
 * Stored in Google Sheets FM_Profiles tab.
 */

/**
 * FM Profile definition.
 */
export type FmProfile = {
  /** Unique FM key (slug, lowercase) */
  fmKey: string;
  /** Display name */
  fmLabel: string;
  /** Page number (1-indexed) */
  page: number;
  /** X position as percentage (0..1) */
  xPct: number;
  /** Y position as percentage (0..1) */
  yPct: number;
  /** Width as percentage (0..1) */
  wPct: number;
  /** Height as percentage (0..1) */
  hPct: number;
  /** Optional: comma-separated sender domains */
  senderDomains?: string;
  /** Optional: comma-separated subject keywords */
  subjectKeywords?: string;
};

/**
 * Normalize FM key to lowercase slug.
 */
export function normalizeFmKey(input: string): string {
  if (!input || typeof input !== "string") {
    return "";
  }
  return input.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * Preset configurations for common OCR zone patterns.
 */
export const FM_PROFILE_PRESETS = {
  "Top Right WO#": {
    xPct: 0.62,
    yPct: 0.05,
    wPct: 0.33,
    hPct: 0.10,
  },
  "Left Third Down": {
    xPct: 0.05,
    yPct: 0.18,
    wPct: 0.45,
    hPct: 0.12,
  },
  "Top Right Panel": {
    xPct: 0.62,
    yPct: 0.14,
    wPct: 0.33,
    hPct: 0.20,
  },
} as const;

/**
 * Validate FM profile data.
 */
export function validateFmProfile(profile: Partial<FmProfile>): string | null {
  if (!profile.fmKey || profile.fmKey.trim() === "") {
    return "FM Key is required";
  }

  if (!profile.fmLabel || profile.fmLabel.trim() === "") {
    return "FM Label is required";
  }

  if (profile.page !== undefined && (profile.page < 1 || !Number.isInteger(profile.page))) {
    return "Page must be an integer >= 1";
  }

  const validatePct = (value: number | undefined, name: string): string | null => {
    if (value === undefined) return null;
    if (typeof value !== "number" || isNaN(value)) {
      return `${name} must be a number`;
    }
    if (value < 0 || value > 1) {
      return `${name} must be between 0 and 1`;
    }
    return null;
  };

  const errors = [
    validatePct(profile.xPct, "xPct"),
    validatePct(profile.yPct, "yPct"),
    validatePct(profile.wPct, "wPct"),
    validatePct(profile.hPct, "hPct"),
  ].filter((e): e is string => e !== null);

  if (errors.length > 0) {
    return errors[0];
  }

  if (profile.wPct !== undefined && profile.wPct <= 0) {
    return "wPct must be greater than 0";
  }

  if (profile.hPct !== undefined && profile.hPct <= 0) {
    return "hPct must be greater than 0";
  }

  return null;
}

