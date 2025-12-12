/**
 * NextAuth (Auth.js v5) configuration for Work Order Extractor 2.0.
 * 
 * This file configures authentication using Google OAuth provider.
 * 
 * Current setup:
 * - Google OAuth provider (basic profile/email scopes)
 * - JWT session strategy (no database adapter yet)
 * - Minimal scopes for now; ready to expand for Sheets/Gmail later
 * 
 * Environment variables required:
 * - AUTH_SECRET: Secret for JWT signing (generate with: openssl rand -base64 32)
 * - GOOGLE_CLIENT_ID: Google OAuth client ID
 * - GOOGLE_CLIENT_SECRET: Google OAuth client secret
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getGoogleScopes } from "@/lib/google/scopes";

/**
 * Validate required environment variables.
 * Returns error message if missing, null if all present.
 */
function validateEnvVars(): string | null {
  const missing: string[] = [];
  
  if (!process.env.AUTH_SECRET) {
    missing.push("AUTH_SECRET");
  }
  
  if (!process.env.GOOGLE_CLIENT_ID) {
    missing.push("GOOGLE_CLIENT_ID");
  }
  
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    missing.push("GOOGLE_CLIENT_SECRET");
  }
  
  if (missing.length > 0) {
    return `Missing required environment variables: ${missing.join(", ")}. ` +
      `Please set these in your production environment variables.`;
  }
  
  return null;
}

/**
 * NextAuth configuration.
 * 
 * Uses Google provider with minimal scopes for now.
 * JWT sessions are used (no database adapter in this phase).
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          scope: getGoogleScopes(),
          access_type: "offline",
          prompt: "consent", // Force consent to get refresh_token at least once
        },
      },
    }),
  ],
  
  session: {
    strategy: "jwt",
    // JWT expires in 30 days (adjust as needed)
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
  },

  callbacks: {
    /**
     * JWT callback: called whenever a JWT is created or updated.
     * 
     * Stores basic user info and a stable userId (from Google's 'sub' claim).
     * 
     * TODO: When adding Sheets/Gmail integration, store Google access/refresh tokens here:
     * - token.accessToken = account.access_token
     * - token.refreshToken = account.refresh_token
     * - token.expiresAt = account.expires_at
     * 
     * These tokens will be needed to make API calls to Google Sheets/Gmail APIs.
     */
    async jwt({ token, account, user, profile }) {
      // Initial sign in: store user info
      if (account && user) {
        // Use Google's 'sub' (subject) as the stable userId
        // This is a unique identifier for the user's Google account
        token.userId = (user.id ?? (profile as any)?.sub ?? (account as any)?.sub) as string;
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        
        // Store Google OAuth tokens for Gmail API access
        if (account.access_token) {
          (token as any).googleAccessToken = account.access_token;
        }
        if (account.refresh_token) {
          (token as any).googleRefreshToken = account.refresh_token;
        }
        if (account.expires_at) {
          (token as any).googleExpiresAt = account.expires_at;
        }
      }
      
      return token;
    },

    /**
     * Session callback: called whenever a session is accessed.
     * 
     * Maps JWT token data to the session object that's available to components.
     * 
     * TODO: When adding Sheets/Gmail, expose accessToken in session if needed:
     * - session.accessToken = token.accessToken
     * 
     * Note: Be careful about exposing tokens in client-side session.
     * Consider keeping tokens server-side only and using them in API routes.
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.image = token.picture as string;
      }
      
      // Store userId on session for server-side access
      (session as any).userId = token.userId as string;
      
      // Expose Google access token for server-side Gmail API calls
      if ((token as any).googleAccessToken) {
        (session as any).googleAccessToken = (token as any).googleAccessToken;
      }
      if ((token as any).googleRefreshToken) {
        (session as any).googleRefreshToken = (token as any).googleRefreshToken;
      }
      
      return session;
    },
  },

  pages: {
    // Optional: customize sign-in page
    // signIn: "/auth/signin",
  },
});

