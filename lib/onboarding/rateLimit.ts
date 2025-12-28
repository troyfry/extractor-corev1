/**
 * Simple in-memory rate limiting for onboarding routes.
 * Prevents spam calls that could create duplicate resources.
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 2000; // 2 seconds
const RATE_LIMIT_MAX_REQUESTS = 1; // 1 request per window

/**
 * Check if a request should be rate limited.
 * Returns true if the request should be allowed, false if rate limited.
 */
export function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || now > entry.resetAt) {
    // No entry or window expired, allow request
    rateLimitMap.set(identifier, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    // Rate limit exceeded
    return false;
  }

  // Increment count
  entry.count++;
  return true;
}

/**
 * Get remaining time until rate limit resets (in ms).
 */
export function getRateLimitResetTime(identifier: string): number {
  const entry = rateLimitMap.get(identifier);
  if (!entry) return 0;
  return Math.max(0, entry.resetAt - Date.now());
}

