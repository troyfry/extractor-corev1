/**
 * Extract work order fields from email subject line using regex patterns (no AI required).
 * 
 * This is a fallback when AI is not available. It uses regex patterns to extract:
 * - Scheduled date (various formats)
 * - NTE (Not To Exceed) amount
 * - Location/service address
 * 
 * Patterns are based on common email subject formats like:
 * "PCC # 1771 - FORESTVILLE, MD WO# 1910527 NTE: $200.00 Scheduled: 12/05/2025"
 */

export interface EmailSubjectExtraction {
  scheduledDate: string | null; // ISO format YYYY-MM-DD
  nteAmount: string | null; // Numeric string
  serviceAddress: string | null; // Full address
  location: string | null; // Location name/identifier
}

/**
 * Parse date string in various formats and convert to ISO (YYYY-MM-DD).
 */
function parseDateToISO(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;

  const cleaned = dateStr.trim();
  
  // Try ISO format first (YYYY-MM-DD)
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return cleaned;
  }

  // Try US format (MM/DD/YYYY or M/D/YYYY)
  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, '0');
    const day = usMatch[2].padStart(2, '0');
    const year = usMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Try US format with dashes (MM-DD-YYYY)
  const usDashMatch = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (usDashMatch) {
    const month = usDashMatch[1].padStart(2, '0');
    const day = usDashMatch[2].padStart(2, '0');
    const year = usDashMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Try European format (DD/MM/YYYY) - less common but possible
  const euMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (euMatch) {
    // Ambiguous - could be US or EU format
    // For now, assume US format (MM/DD/YYYY) as it's more common
    const month = euMatch[1].padStart(2, '0');
    const day = euMatch[2].padStart(2, '0');
    const year = euMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Extract scheduled date from email subject using regex patterns.
 */
function extractScheduledDate(subject: string): string | null {
  // Pattern: "Scheduled: 12/05/2025" or "Scheduled: 12-05-2025"
  const scheduledPattern = /(?:Scheduled|Schedule|Date|Appointment)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i;
  const scheduledMatch = subject.match(scheduledPattern);
  if (scheduledMatch && scheduledMatch[1]) {
    const parsed = parseDateToISO(scheduledMatch[1]);
    if (parsed) return parsed;
  }

  // Pattern: "12/05/2025" near "Scheduled" keyword
  const nearScheduledPattern = /(?:Scheduled|Schedule|Date|Appointment)[:\s]+([A-Za-z]+\s+)?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i;
  const nearMatch = subject.match(nearScheduledPattern);
  if (nearMatch && nearMatch[2]) {
    const parsed = parseDateToISO(nearMatch[2]);
    if (parsed) return parsed;
  }

  // Pattern: Date at end of subject (common format)
  const endDatePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})$/;
  const endMatch = subject.match(endDatePattern);
  if (endMatch && endMatch[1]) {
    const parsed = parseDateToISO(endMatch[1]);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Extract NTE amount from email subject using regex patterns.
 */
function extractNteAmount(subject: string): string | null {
  // Pattern: "NTE: $200.00" or "NTE $200" or "Not To Exceed: $200.00"
  const ntePatterns = [
    /(?:NTE|Not\s+To\s+Exceed)[:\s]+\$?([\d,]+\.?\d*)/i,
    /(?:NTE|Not\s+To\s+Exceed)[:\s]+([\d,]+\.?\d*)/i,
  ];

  for (const pattern of ntePatterns) {
    const match = subject.match(pattern);
    if (match && match[1]) {
      // Remove commas and extract numeric value
      const cleaned = match[1].replace(/,/g, '');
      const num = parseFloat(cleaned);
      if (!Number.isNaN(num) && num > 0) {
        return num.toFixed(2);
      }
    }
  }

  return null;
}

/**
 * Extract location from email subject using regex patterns.
 * Location is typically a city name, facility name, or location identifier.
 */
function extractLocation(subject: string): string | null {
  // Pattern: Location before "WO#" or work order number
  // Example: "PCC # 1771 - FORESTVILLE, MD WO# 1910527"
  const beforeWoPattern = /^(.+?)(?:\s+WO#|\s+WO\s+|\s+#\s*\d+)/i;
  const beforeMatch = subject.match(beforeWoPattern);
  if (beforeMatch && beforeMatch[1]) {
    const location = beforeMatch[1].trim();
    // Clean up common prefixes
    const cleaned = location
      .replace(/^PCC\s*#?\s*\d+\s*[-–]\s*/i, '') // Remove "PCC # 1771 -"
      .replace(/^[A-Z]+\s*#?\s*\d+\s*[-–]\s*/i, '') // Remove other prefixes like "STORE # 123 -"
      .trim();
    
    if (cleaned && cleaned.length > 2 && cleaned.length < 100) {
      return cleaned;
    }
  }

  // Pattern: Location after certain keywords
  const afterKeywordPattern = /(?:Location|Store|Facility|Site)[:\s]+([A-Z][A-Za-z\s,]+?)(?:\s+WO|\s+NTE|\s+Scheduled|$)/i;
  const afterMatch = subject.match(afterKeywordPattern);
  if (afterMatch && afterMatch[1]) {
    const location = afterMatch[1].trim();
    if (location && location.length > 2 && location.length < 100) {
      return location;
    }
  }

  // Pattern: City, State format (e.g., "FORESTVILLE, MD")
  const cityStatePattern = /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?),\s*[A-Z]{2}(?:\s+WO|\s+NTE|\s+Scheduled|$)/i;
  const cityMatch = subject.match(cityStatePattern);
  if (cityMatch && cityMatch[1]) {
    const location = cityMatch[0].trim();
    if (location && location.length > 2 && location.length < 100) {
      return location;
    }
  }

  return null;
}

/**
 * Extract service address from email subject (full address if present).
 * Falls back to location if it looks like an address (city, state format).
 */
function extractServiceAddress(subject: string, location: string | null): string | null {
  // Pattern: Full address format (street number, street name, city, state, zip)
  const addressPattern = /\d+\s+[A-Z][A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Circle|Cir)[,\s]+[A-Z][A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/i;
  const addressMatch = subject.match(addressPattern);
  if (addressMatch && addressMatch[0]) {
    return addressMatch[0].trim();
  }

  // Pattern: Address with street number and name (without requiring full format)
  const partialAddressPattern = /\d+\s+[A-Z][A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Circle|Cir)[,\s]+[A-Z][A-Za-z\s]+,\s*[A-Z]{2}/i;
  const partialMatch = subject.match(partialAddressPattern);
  if (partialMatch && partialMatch[0]) {
    return partialMatch[0].trim();
  }

  // Pattern: Address after "Address:" keyword
  const addressKeywordPattern = /(?:Address|Service\s+Address|Service\s+Location)[:\s]+(.+?)(?:\s+WO|\s+NTE|\s+Scheduled|$)/i;
  const keywordMatch = subject.match(addressKeywordPattern);
  if (keywordMatch && keywordMatch[1]) {
    const address = keywordMatch[1].trim();
    if (address && address.length > 5 && address.length < 200) {
      return address;
    }
  }

  // Pattern: City, State format anywhere in subject (common format)
  // This catches "FORESTVILLE, MD" type addresses
  const cityStatePattern = /([A-Z][A-Za-z\s]+(?:,\s*[A-Z]{2})?)/g;
  const cityStateMatches = subject.matchAll(cityStatePattern);
  for (const match of cityStateMatches) {
    const candidate = match[0].trim();
    // Check if it's a valid city, state format (not too short, has comma + state)
    if (candidate.includes(',') && candidate.match(/,\s*[A-Z]{2}$/)) {
      // Make sure it's not part of a work order number or other pattern
      if (!candidate.match(/WO|#\d|NTE|Scheduled/i) && candidate.length > 5 && candidate.length < 100) {
        return candidate;
      }
    }
  }

  // Fallback: Use location if it looks like an address (city, state format)
  // This is common in email subjects where location is the only address info
  if (location) {
    // Check if location is in "City, State" format
    const cityStateMatch = location.match(/^[A-Z][A-Za-z\s]+,\s*[A-Z]{2}$/);
    if (cityStateMatch) {
      return location; // Use location as service address
    }
    
    // Check if location contains address-like patterns
    const hasAddressKeywords = /(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Circle|Cir|,\s*[A-Z]{2})/i.test(location);
    if (hasAddressKeywords) {
      return location;
    }
  }

  return null;
}

/**
 * Extract work order fields from email subject using regex patterns (no AI required).
 * 
 * @param emailSubject The email subject line
 * @returns Extracted fields or null if subject is empty
 */
export function extractFromEmailSubjectRegex(
  emailSubject: string
): EmailSubjectExtraction | null {
  if (!emailSubject || !emailSubject.trim()) {
    return null;
  }

  const subject = emailSubject.trim();

  // Extract each field using regex patterns
  const scheduledDate = extractScheduledDate(subject);
  const nteAmount = extractNteAmount(subject);
  const location = extractLocation(subject);
  // Service address extraction can use location as fallback
  const serviceAddress = extractServiceAddress(subject, location);

  // Return result even if some fields are null (partial extraction is useful)
  return {
    scheduledDate,
    nteAmount,
    serviceAddress,
    location,
  };
}
