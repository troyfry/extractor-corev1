/**
 * Get current authenticated user.
 * 
 * This is the centralized way to get the current user in API routes.
 * Use this instead of calling auth() directly.
 * 
 * @returns AppUser if authenticated, null otherwise
 */
import { auth } from "@/auth";

export type AppUser = {
  id: string;
  email: string | null;
  userId: string; // Google OAuth 'sub' claim - stable user identifier
  googleAccessToken?: string; // Google OAuth access token (for Gmail API)
  googleRefreshToken?: string; // Google OAuth refresh token
};

export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await auth();
  
  if (!session || !session.userId) {
    return null;
  }

  return {
    id: session.user.id || session.user.email || session.userId,
    email: session.user.email || null,
    userId: session.userId,
    googleAccessToken: (session as { googleAccessToken?: string }).googleAccessToken || null,
    googleRefreshToken: (session as { googleRefreshToken?: string }).googleRefreshToken || null,
  };
}
