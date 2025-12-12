/**
 * AuthProvider component.
 * 
 * Wraps the NextAuth SessionProvider for client components.
 * This allows client components to use useSession() hook.
 * 
 * Usage: Wrap your app in this provider in the root layout.
 */

"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

interface AuthProviderProps {
  children: ReactNode;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  return <SessionProvider>{children}</SessionProvider>;
}

