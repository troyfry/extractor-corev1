"use client";

import Link from "next/link";
import { ROUTES } from "@/lib/routes";

export default function Footer() {
  return (
    <footer className="mt-12 py-8 border-t border-gray-700 bg-gray-900 text-center text-sm text-gray-400">
      <div className="max-w-6xl mx-auto px-4">
        <div className="space-x-4 mb-4">
          <Link
            href={ROUTES.legal}
            className="hover:text-gray-300 underline underline-offset-4 transition-colors"
          >
            Legal
          </Link>

          <Link
            href={ROUTES.legalPrivacy}
            className="hover:text-gray-300 underline underline-offset-4 transition-colors"
          >
            Privacy Policy
          </Link>

          <Link
            href={ROUTES.legalTerms}
            className="hover:text-gray-300 underline underline-offset-4 transition-colors"
          >
            Terms of Use
          </Link>
        </div>

        <p className="text-gray-500">
          © {new Date().getFullYear()} Work Order Extractor. All rights
          reserved.
        </p>
      </div>
      <p className="mt-1">© {new Date().getFullYear()} Work Order Extractor</p>

      <p className="mt-1">Intended for U.S. users and businesses.</p>
    </footer>
  );
}
