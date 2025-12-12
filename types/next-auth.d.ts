/**
 * TypeScript declarations for NextAuth to extend the default types.
 * 
 * This file extends the NextAuth Session and JWT types to include
 * custom fields we add in our callbacks.
 */

import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    userId?: string; // Stable user ID from Google's 'sub' claim
    googleAccessToken?: string; // Google OAuth access token for Gmail API
    googleRefreshToken?: string; // Google OAuth refresh token
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string; // Stable user ID from Google's 'sub' claim
    id: string;
    email: string;
    name: string;
    picture?: string | null;
    googleAccessToken?: string; // Google OAuth access token for Gmail API
    googleRefreshToken?: string; // Google OAuth refresh token
    googleExpiresAt?: number; // Token expiration timestamp
  }
}

