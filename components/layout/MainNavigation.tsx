"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";
import { canUseProFeatures, canUsePremiumFeatures } from "@/lib/planVisibility";

type NavMode = "gmail" | "file" | "signed" | "work-orders" | "invoices" | "portal" | "integrations";

interface NavItem {
  id: NavMode;
  label: string;
  href: string;
  icon: React.ReactNode;
  disabled?: boolean;
  premiumOnly?: boolean;
  featureKey?: keyof import("@/lib/plan").FeatureFlags;
}

interface MainNavigationProps {
  currentMode?: NavMode;
}

export default function MainNavigation({ currentMode }: MainNavigationProps) {
  const pathname = usePathname();
  const { plan } = useCurrentPlan();
  const canUseGmail = hasFeature(plan, "canUseGmailImport");
  const canUseInvoices = hasFeature(plan, "canUseInvoices");
  const canUsePortal = hasFeature(plan, "canUseCustomerPortal");
  const canUseIntegrations = hasFeature(plan, "canUseIntegrations");
  const isFreePlan = plan === "FREE_BYOK";
  
  // Check visibility with dev override
  const canUsePro = canUseProFeatures(plan);
  const canUsePremium = canUsePremiumFeatures(plan);

  // Define all nav items (keep all code intact for Pro/Premium)
  const allNavItems: NavItem[] = [
    {
      id: "gmail",
      label: "From Inbox",
      href: "/",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      disabled: !canUseGmail,
      featureKey: "canUseGmailImport",
    },
    {
      id: "file",
      label: "From File",
      href: isFreePlan ? "/free" : "/dashboard",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: "signed",
      label: "Signed Documents",
      href: "/pro/signed-test",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      disabled: !canUsePro,
    },
    {
      id: "work-orders",
      label: "Work Orders",
      href: "/pro/work-orders",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      disabled: !canUsePro,
    },
    {
      id: "invoices",
      label: "Invoices",
      href: "/invoices",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      disabled: !canUseInvoices,
      premiumOnly: true, // Premium-only feature
      featureKey: "canUseInvoices",
    },
    {
      id: "portal",
      label: "Portal",
      href: "/portal",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      disabled: !canUsePortal,
      premiumOnly: true,
      featureKey: "canUseCustomerPortal",
    },
    {
      id: "integrations",
      label: "Integrations",
      href: "/integrations",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      disabled: !canUseIntegrations,
      premiumOnly: true,
      featureKey: "canUseIntegrations",
    },
  ];

  // Filter nav items based on plan
  // CRITICAL: Free users should NEVER see "From Inbox" (Gmail) - it's not available on Free plan
  // Only show "From File" for Free users
  // IMPORTANT: Only filter if plan is explicitly FREE_BYOK and Gmail is not available
  const navItems = (() => {
    // Only filter if plan is explicitly Free AND Gmail is not available
    // In dev mode, canUsePro is always true, so we need to check the plan directly
    // This ensures Pro/Premium plans always show all tabs, even during navigation
    if (plan === "FREE_BYOK" && !canUseGmail) {
      return allNavItems.filter((item) => item.id === "file");
    }
    // For Pro/Premium users, always show all items
    return allNavItems;
  })();

  // Determine active state from pathname if currentMode not provided
  const isActive = (item: NavItem) => {
    // If currentMode is explicitly provided, use it (highest priority)
    if (currentMode) {
      return currentMode === item.id;
    }
    
    // For Free plan users (without dev override), only "From File" can be active
    // CRITICAL: Free users should NEVER see "From Inbox" (Gmail) as active
    if (isFreePlan && !canUsePro) {
      // Explicitly prevent Gmail/Inbox from being active for Free users
      if (item.id === "gmail" || item.href === "/") {
        return false;
      }
      // If user is on Gmail page (/) but is Free plan, show "From File" as active
      // This handles the case where redirect is in progress
      if (pathname === "/" && item.id === "file") {
        return true;
      }
      // Only "From File" should be active for Free users
      // Match /free or /manual (legacy redirect)
      if (item.id === "file") {
        return pathname === "/free" || pathname === "/manual" || pathname?.startsWith("/free");
      }
      // Other nav items shouldn't be active for Free users
      return false;
    }
    
    // For Pro/Premium users, use normal pathname matching
    // For "From File", match both /dashboard and /manual (legacy redirect)
    if (item.id === "file") {
      return pathname === "/dashboard" || pathname === "/manual" || pathname?.startsWith("/dashboard");
    }
    // For "Signed Documents", match /pro/signed-test
    if (item.id === "signed") {
      return pathname === "/pro/signed-test" || pathname?.startsWith("/pro/signed");
    }
    // For "Work Orders", match /pro/work-orders
    if (item.id === "work-orders") {
      return pathname === "/pro/work-orders" || pathname?.startsWith("/pro/work-orders");
    }
    return pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
  };

  const handleClick = (item: NavItem, e: React.MouseEvent) => {
    // Only handle disabled clicks for Pro/Premium plans
    // Free plan users won't see these items at all
    if (item.disabled && !isFreePlan) {
      e.preventDefault();
      if (item.premiumOnly) {
        if (item.featureKey === "canUseInvoices") {
          alert("Invoices is only available on the Premium plan. Please upgrade to access invoice management, payment tracking, and aging reports.");
        } else {
          alert(`${item.label} is only available on the Premium plan. Please upgrade to access this feature.`);
        }
      } else if (item.featureKey === "canUseGmailImport") {
        alert("Gmail import is only available on Pro and Premium plans. Please upgrade to access this feature.");
      } else {
        alert(`${item.label} is not available on your current plan. Please upgrade to access this feature.`);
      }
    }
  };

  return (
    <nav className="bg-gray-800 border-b border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1 flex-wrap">
          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.id}
                href={item.disabled ? "#" : item.href}
                onClick={(e) => handleClick(item, e)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative
                  ${
                    active
                      ? "text-white border-b-2 border-red-500"
                      : item.disabled
                      ? "text-gray-600 cursor-not-allowed"
                      : "text-gray-400 hover:text-gray-300"
                  }
                `}
              >
                {item.icon}
                <span>{item.label}</span>
                {/* Only show badges/locks for Pro/Premium plans, not Free */}
                {!isFreePlan && item.premiumOnly && !item.disabled && (
                  <span className="px-1.5 py-0.5 bg-purple-700 text-purple-200 rounded text-xs font-medium ml-1">
                    Premium
                  </span>
                )}
                {!isFreePlan && item.disabled && item.premiumOnly && (
                  <svg
                    className="w-4 h-4 text-gray-500 ml-1"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

