/**
 * UserMenu component.
 * 
 * Displays user authentication UI:
 * - If signed out: "Sign in with Google" button
 * - If signed in: User avatar, name/email, and "Sign out" option
 */

"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";
import Link from "next/link";

export default function UserMenu() {
  const { data: session, status } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-gray-700 animate-pulse" />
        <div className="h-4 w-24 bg-gray-700 rounded animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <button
        onClick={() => signIn("google")}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
      >
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsMenuOpen(!isMenuOpen)}
        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-700 transition-colors"
      >
        {session.user?.image ? (
          <img
            src={session.user.image}
            alt={session.user.name || "User"}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-medium">
            {session.user?.name?.charAt(0).toUpperCase() || "U"}
          </div>
        )}
        <div className="text-left hidden sm:block">
          <div className="text-sm text-white font-medium">
            {session.user?.name || "User"}
          </div>
          <div className="text-xs text-gray-400">
            {session.user?.email}
          </div>
        </div>
        <svg
          className="w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsMenuOpen(false)}
          />
          
          {/* Dropdown menu */}
          <div className="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-20">
            <div className="px-4 py-3 border-b border-gray-700">
              <div className="text-sm text-white font-medium">
                {session.user?.name || "User"}
              </div>
              <div className="text-xs text-gray-400 truncate">
                {session.user?.email}
              </div>
            </div>
            <div className="py-1">
              <Link
                href="/settings"
                onClick={() => setIsMenuOpen(false)}
                className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Settings
              </Link>
              <button
                onClick={() => {
                  signOut();
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

