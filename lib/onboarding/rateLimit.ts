/**
 * Simple in-memory rate limiter for onboarding API calls.
 * Prevents spam/abuse by limiting requests per key.
 * 
 * Note: This is a basic implementation. For production, consider using
 * a more robust solution like Redis or a proper rate limiting library.
 */

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Rate limit: 5 requests per 60 seconds per key
const MAX_REQUESTS = 5;
const WINDOW_MS = 60 * 1000; // 60 seconds

/**
 * Check if a rate limit key has exceeded the limit.
 * Returns true if the request is allowed, false if rate limited.
 */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  // No entry or window expired - allow request and reset
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    return true;
  }

  // Within window - check count
  if (entry.count >= MAX_REQUESTS) {
    return false; // Rate limited
  }

  // Increment count
  entry.count++;
  return true; // Allowed
}

/**
 * Clear rate limit for a specific key (useful for testing or manual reset).
 */
export function clearRateLimit(key: string): void {
  rateLimitMap.delete(key);
}

/**
 * Clear all rate limits (useful for testing).
 */
export function clearAllRateLimits(): void {
  rateLimitMap.clear();
}

