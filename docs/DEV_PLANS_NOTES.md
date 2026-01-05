# Plan System Documentation

This document explains how the plan system works and how to extend it.

## Overview

The app uses a three-tier plan system:
- **FREE_BYOK**: Free tier with Bring Your Own Key (BYOK) support
- **PRO**: Professional tier with server-side AI processing and advanced features
- **PREMIUM**: Premium tier with all features including customer portal and integrations

## Core Files

### `lib/plan.ts`
**Central definition file** - Contains all plan-related types and core logic:
- `Plan` type: Union type of all available plans
- `FeatureFlags` type: All feature flags that can be enabled/disabled
- `featuresByPlan`: Maps each plan to its feature configuration
- `getDefaultPlan()`: Returns the default plan (currently "PRO")
- `getCurrentPlan()`: Server-side plan resolution (currently returns default)
- `hasFeature(plan, featureKey)`: Checks if a feature is enabled for a plan

### `lib/plan-helpers.ts`
**Utility functions** - Helper functions to reduce duplication:
- `isFreePlan(plan)`, `isProPlan(plan)`, `isPremiumPlan(plan)`: Plan type checks
- `requiresBYOK(plan)`, `usesServerKey(plan)`: Key usage checks
- `getPlanLabel(plan)`, `getPlanShortLabel(plan)`: Human-readable labels
- `isValidPlan(plan)`: Validates plan strings

### `lib/plan-context.tsx`
**Client-side plan management** - React context and hook:
- `PlanProvider`: Wraps the app to provide plan context
- `useCurrentPlan()`: Hook to access current plan and setter
- **Note**: Currently uses localStorage for dev testing. Will be replaced with server-side resolution.

### `lib/api/getPlanFromRequest.ts`
**Server-side plan resolution** - Gets plan from API requests:
- Reads from `x-plan` header (dev only)
- **TODO**: Replace with session/billing lookup

### `lib/api/getOpenAIKey.ts`
**Key selection logic** - Determines which OpenAI key to use:
- FREE_BYOK: Reads from `x-openai-key` header
- PRO/PREMIUM: Uses server-side `OPENAI_API_KEY`
- **Safety**: Enforces plan-based key selection to prevent cross-contamination

## Feature Flags

Feature flags are defined in `featuresByPlan` in `lib/plan.ts`. To add a new feature:

1. Add the feature flag to `FeatureFlags` type:
```typescript
export type FeatureFlags = {
  // ... existing flags
  canUseNewFeature: boolean;
};
```

2. Set the flag for each plan in `featuresByPlan`:
```typescript
export const featuresByPlan: Record<Plan, FeatureFlags> = {
  FREE_BYOK: {
    // ... existing flags
    canUseNewFeature: false,
  },
  PRO: {
    // ... existing flags
    canUseNewFeature: true, // or false
  },
  PREMIUM: {
    // ... existing flags
    canUseNewFeature: true,
  },
};
```

3. Use the flag in your code:
```typescript
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";

const { plan } = useCurrentPlan();
if (hasFeature(plan, "canUseNewFeature")) {
  // Show feature
}
```

## UI Gating

### Client-Side (React Components)

Use `useCurrentPlan()` hook and `hasFeature()`:

```typescript
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";

const { plan } = useCurrentPlan();
const canUseFeature = hasFeature(plan, "canUseFeatureName");

if (!canUseFeature) {
  return <UpgradePrompt requiredPlan="PREMIUM" featureName="Feature Name" />;
}
```

### Server-Side (API Routes)

Use `getPlanFromRequest()` and `hasFeature()`:

```typescript
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";

const plan = getPlanFromRequest(request);
if (!hasFeature(plan, "canUseFeatureName")) {
  return NextResponse.json({ error: "Feature not available" }, { status: 403 });
}
```

### Navigation

Navigation items are gated in `components/layout/MainNavigation.tsx`:
- Set `disabled: !hasFeature(plan, "featureKey")` on nav items
- Use `premiumOnly: true` to show Premium badge
- Clicking disabled items shows upgrade message

## Shared Components

### `components/plan/PlanBanner.tsx`
Shows current plan and upgrade CTA. Use in headers/sidebars.

### `components/plan/UpgradePrompt.tsx`
Shows upgrade message for gated features. Use when feature is not available.

### `components/plan/BYOKKeyInput.tsx`
Input component for BYOK key (FREE_BYOK plan only).

### `components/plan/PlanSelector.tsx`
**DEV ONLY** - Plan switcher for testing. Hidden in production.

## Adding a New Feature and Gating It

### Step 1: Define the Feature Flag
Add to `FeatureFlags` type and `featuresByPlan` in `lib/plan.ts`.

### Step 2: Create the Feature UI
Create your component/page, then gate it:

```typescript
import { useCurrentPlan } from "@/lib/plan-context";
import { hasFeature } from "@/lib/plan";
import UpgradePrompt from "@/components/plan/UpgradePrompt";

export default function MyFeaturePage() {
  const { plan } = useCurrentPlan();
  
  if (!hasFeature(plan, "canUseMyFeature")) {
    return (
      <UpgradePrompt 
        requiredPlan="PREMIUM" 
        featureName="My Feature"
        description="Custom description here"
      />
    );
  }
  
  // Feature UI here
}
```

### Step 3: Gate API Routes
In your API route:

```typescript
import { getPlanFromRequest } from "@/lib/api/getPlanFromRequest";
import { hasFeature } from "@/lib/plan";

export async function POST(request: Request) {
  const plan = getPlanFromRequest(request);
  
  if (!hasFeature(plan, "canUseMyFeature")) {
    return NextResponse.json(
      { error: "Feature not available on your plan" },
      { status: 403 }
    );
  }
  
  // Feature logic here
}
```

### Step 4: Add Navigation (if needed)
Add to `MainNavigation.tsx` with proper gating.

## Safeguards

### Key Usage Safety
- `getOpenAIKeyForPlan()` enforces plan-based key selection
- FREE_BYOK can never use server keys
- PRO/PREMIUM can never use BYOK keys

### Default Plan
- `getDefaultPlan()` returns "PRO" to maintain backward compatibility
- All new users default to PRO unless explicitly set

### Development Tools
- `PlanSelector` component is DEV ONLY (hidden in production)
- Plan switching via localStorage is dev-only
- All dev-only code is clearly marked with comments

## Future Integration Points

### Authentication/Billing Integration

**Client-Side (`lib/plan-context.tsx`):**
```typescript
// TODO: Replace localStorage with server-side plan lookup
const plan = await fetchUserPlan(session.userId);
```

**Server-Side (`lib/api/getPlanFromRequest.ts`):**
```typescript
// TODO: Replace header reading with session lookup
const session = await auth();
const plan = await getPlanFromBilling(session.userId);
```

**Server-Side (`lib/plan.ts`):**
```typescript
// TODO: Replace default plan with user's actual plan
export function getCurrentPlan(userId: string): Promise<Plan> {
  return getPlanFromBilling(userId);
}
```

## Best Practices

1. **Always use helpers**: Use `hasFeature()` instead of `plan === "X"` checks
2. **Use plan-helpers**: Use `isFreePlan()`, `requiresBYOK()`, etc. instead of direct comparisons
3. **Gate at multiple levels**: Gate in UI, API routes, and navigation
4. **Use shared components**: Use `UpgradePrompt` and `PlanBanner` for consistency
5. **Document new features**: Update this file when adding new features

## Testing

In development, use the `PlanSelector` component to switch between plans and test:
- FREE_BYOK: BYOK key input, no Gmail, no Premium features
- PRO: Server key, Gmail, invoices, no Premium features
- PREMIUM: All features available

