/**
 * Google OAuth scopes configuration.
 * 
 * This file centralizes all Google API scopes used in the application.
 * Currently using minimal identity scopes; will expand for Sheets/Gmail later.
 */

/**
 * Base scopes for user authentication and identity.
 * These are the minimum scopes needed for "Sign in with Google".
 */
export const GOOGLE_BASE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify", // Modify scope allows label removal
] as const;

/**
 * Future expansion: Google Sheets API scopes.
 * 
 * When ready to add Sheets integration, uncomment and add to the provider:
 * - "https://www.googleapis.com/auth/spreadsheets" - Full read/write access to Sheets
 * - "https://www.googleapis.com/auth/drive.file" - Access to files created by the app
 * 
 * TODO: Add these scopes to NextAuth provider configuration when implementing Sheets integration.
 */
// export const GOOGLE_SHEETS_SCOPES = [
//   "https://www.googleapis.com/auth/spreadsheets",
//   "https://www.googleapis.com/auth/drive.file",
// ] as const;

/**
 * Future expansion: Gmail API scopes.
 * 
 * When ready to add Gmail integration, uncomment and add to the provider:
 * - "https://www.googleapis.com/auth/gmail.readonly" - Read-only access to Gmail
 * - "https://www.googleapis.com/auth/gmail.modify" - Read and modify Gmail (if needed)
 * 
 * TODO: Add these scopes to NextAuth provider configuration when implementing Gmail integration.
 */
// export const GOOGLE_GMAIL_SCOPES = [
//   "https://www.googleapis.com/auth/gmail.readonly",
// ] as const;

/**
 * Get all active Google scopes as a space-separated string.
 * Currently returns base scopes only.
 * 
 * When Sheets/Gmail are added, combine all relevant scopes here.
 */
export function getGoogleScopes(): string {
  return GOOGLE_BASE_SCOPES.join(" ");
  
  // Future: combine scopes when Sheets/Gmail are added
  // return [
  //   ...GOOGLE_BASE_SCOPES,
  //   ...GOOGLE_SHEETS_SCOPES,
  //   ...GOOGLE_GMAIL_SCOPES,
  // ].join(" ");
}

