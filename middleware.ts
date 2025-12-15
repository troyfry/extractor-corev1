/**
 * Next.js middleware for protecting routes.
 * 
 * This middleware checks authentication status and redirects
 * unauthenticated users to a sign-in page for protected routes.
 * 
 * Free tier routes are accessible without authentication:
 * - /free - Free tier work order extraction page
 * - /api/extract-free - Free tier API endpoint
 * 
 * Currently protects all routes except:
 * - /api/auth/* (authentication endpoints)
 * - /auth/* (sign-in pages)
 * - /free (free tier page - no auth required)
 * - /api/extract-free (free tier API - no auth required)
 * - /pricing (pricing page - public)
 * - /legal (legal pages - public)
 */

import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  
  // Handle auth errors gracefully
  let isAuthenticated = false;
  try {
    isAuthenticated = !!req.auth;
  } catch (error) {
    console.error("[Middleware] Auth error:", error);
    // If auth fails, treat as unauthenticated
    // This prevents server errors from breaking the app
  }

  // Allow access to auth API routes
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Allow access to auth pages (sign-in page)
  if (pathname.startsWith("/auth")) {
    return NextResponse.next();
  }

  // Allow access to free tier page without authentication
  if (pathname === "/free" || pathname.startsWith("/free/")) {
    return NextResponse.next();
  }

  // Allow access to free tier API endpoint without authentication
  if (pathname === "/api/extract-free" || pathname.startsWith("/api/extract-free/")) {
    return NextResponse.next();
  }

  // Allow access to pricing page (public)
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) {
    return NextResponse.next();
  }

  // Allow access to legal pages (public)
  if (pathname === "/legal" || pathname.startsWith("/legal/")) {
    return NextResponse.next();
  }

  // Protect all other routes (require authentication)
  if (!isAuthenticated) {
    // Redirect to sign-in page
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

// Configure which routes this middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

