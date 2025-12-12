"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Plan, getDefaultPlan } from "@/lib/plan";
import { isValidPlan } from "@/lib/plan-helpers";
import { clearUserApiKey } from "@/lib/byok";

/**
 * Plan Context for client-side plan management.
 * 
 * IMPORTANT: This is currently a development-only implementation.
 * 
 * In development, allows switching plans via localStorage for testing.
 * In production, this will be replaced with server-side plan resolution from auth/billing.
 * 
 * TODO: Replace with server-side plan resolution:
 * - Read plan from user session/billing system
 * - Remove localStorage-based plan switching
 * - Remove PlanSelector component or make it admin-only
 */
interface PlanContextType {
  plan: Plan;
  setPlan: (plan: Plan) => void;
}

const PlanContext = createContext<PlanContextType | undefined>(undefined);

const PLAN_STORAGE_KEY = "dev-plan-override";

export function PlanProvider({ children }: { children: ReactNode }) {
  // TODO: Replace this hard-coded plan with real user plan data
  // from auth/billing (e.g. Clerk + Stripe) in a future phase.
  // 
  // In production, default to FREE_BYOK (Free plan)
  // In development, default to PRO (can be overridden by PlanSelector)
  const getInitialPlan = (): Plan => {
    if (process.env.NODE_ENV === "production") {
      return "FREE_BYOK";
    }
    return getDefaultPlan(); // PRO in dev
  };

  // Always start with initial plan to avoid hydration mismatch
  // We'll load from localStorage in useEffect after hydration
  const [plan, setPlanState] = useState<Plan>(getInitialPlan());
  const [isHydrated, setIsHydrated] = useState(false);

  // Load plan from localStorage after hydration (client-side only)
  // In production, ignore localStorage and always use FREE_BYOK
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (process.env.NODE_ENV !== "production") {
        // In dev, allow localStorage override
        const stored = localStorage.getItem(PLAN_STORAGE_KEY);
        if (stored && isValidPlan(stored)) {
          setPlanState(stored);
          // Auto-clear BYOK if plan is not Free
          if (stored !== "FREE_BYOK") {
            clearUserApiKey();
          }
        } else {
          // Auto-clear BYOK if default plan is not Free
          const initialPlan = getInitialPlan();
          if (initialPlan !== "FREE_BYOK") {
            clearUserApiKey();
          }
        }
      } else {
        // In production, plan stays as FREE_BYOK (set in initial state)
        // No need to clear BYOK for Free plan
      }
      setIsHydrated(true);
    }
  }, []);

  const setPlan = (newPlan: Plan) => {
    // In production, prevent plan changes (plan should come from billing system)
    if (process.env.NODE_ENV === "production") {
      console.warn("Plan changes are not allowed in production. Plan should be set via billing system.");
      return;
    }
    
    // Clear BYOK key when upgrading from Free to Pro/Premium
    const currentPlan = plan;
    if (currentPlan === "FREE_BYOK" && newPlan !== "FREE_BYOK") {
      clearUserApiKey();
    }
    
    setPlanState(newPlan);
    if (typeof window !== "undefined") {
      localStorage.setItem(PLAN_STORAGE_KEY, newPlan);
    }
  };

  // Listen for storage changes (e.g., from another tab)
  useEffect(() => {
    if (typeof window === "undefined" || !isHydrated) return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === PLAN_STORAGE_KEY && e.newValue && isValidPlan(e.newValue)) {
        setPlanState(e.newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [isHydrated]);

  return (
    <PlanContext.Provider value={{ plan, setPlan }}>
      {children}
    </PlanContext.Provider>
  );
}

/**
 * Hook to access the current plan and setter.
 * 
 * @example
 * const { plan, setPlan } = useCurrentPlan();
 * if (plan === "FREE_BYOK") { ... }
 */
export function useCurrentPlan(): PlanContextType {
  const context = useContext(PlanContext);
  if (context === undefined) {
    throw new Error("useCurrentPlan must be used within a PlanProvider");
  }
  return context;
}

