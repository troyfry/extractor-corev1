# Unit Tests

This document describes the unit test suite that runs with `pnpm test`. These tests validate core business logic and prevent regressions in critical functionality.

## Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode (auto-rerun on file changes)
pnpm test:watch

# Run a specific test file
pnpm test tests/coords/templateCoordinateConversion.test.ts
```

## Test Structure

Tests are organized by domain in the `tests/` directory:

```
tests/
├── coords/          # Coordinate conversion tests
├── gmail/           # Gmail label state machine tests
├── signed/          # Signed OCR precondition tests
├── templates/       # Template points-only enforcement tests
└── workspace/       # Workspace resolution tests
```

## Test Coverage

### Coordinate Conversion (`tests/coords/`)

**File**: `templateCoordinateConversion.test.ts`

**Purpose**: Ensures CSS → natural px → PDF points conversion stays consistent and bounded. This is the highest-value regression test.

**What it tests**:
- CSS pixels to PDF points conversion
- PDF points to CSS pixels conversion
- PDF point validation
- Bounds normalization
- Deterministic conversion across different scales

**Why it matters**: Coordinate conversion is the foundation of template storage. Any bugs here corrupt all saved templates.

---

### Workspace Resolution (`tests/workspace/`)

**File**: `getWorkspace.test.ts`

**Purpose**: Ensures workspace resolution follows correct priority:
1. Cookies (fast, zero API calls)
2. Users Sheet (source of truth, rehydrates cookies)
3. Typed error (not silent undefined)

**What it tests**:
- Cookie-based workspace loading
- Users Sheet fallback when cookies missing
- Cookie rehydration after Users Sheet load
- Error handling for missing workspace

**Why it matters**: Workspace resolution is used by all API routes. Incorrect resolution breaks the entire app.

---

### Gmail Label State Machine (`tests/gmail/`)

**File**: `labelStateMachine.test.ts`

**Purpose**: Validates idempotent Gmail label operations for work order processing.

**What it tests**:
- Label application/removal is idempotent
- State transitions (To Process → Processed, etc.)
- Error handling when labels are missing
- Repeated processing doesn't cause errors

**Why it matters**: Gmail labels track work order state. Non-idempotent operations cause duplicate processing or lost work orders.

---

### Signed OCR Preconditions (`tests/signed/`)

**File**: `signedPreconditions.test.ts`

**Purpose**: Validates preconditions before running signed OCR processing.

**What it tests**:
- Template must exist and have valid PDF points
- PDF points validation before OCR
- Error handling for missing/invalid templates

**Why it matters**: Signed OCR is a critical path. Invalid templates cause silent failures or corrupted data.

---

### Template Points-Only Enforcement (`tests/templates/`)

**File**: `pointsOnly.test.ts`

**Purpose**: Regression test to prevent percentage fields from being used in template storage.

**What it tests**:
- Template save routes don't write percentage values
- Template types require PDF points
- No percentage fallback logic exists
- PDF point validation in save endpoints

**Why it matters**: Templates MUST store only PDF points. Percentage fallback causes coordinate corruption.

## Test Framework

Tests use [Vitest](https://vitest.dev/) with Node.js environment.

**Configuration**: `vitest.config.ts`
- Test files: `tests/**/*.test.ts`
- Environment: `node`
- Path alias: `@/` resolves to project root

## Writing New Tests

1. **Create test file**: `tests/<domain>/<feature>.test.ts`
2. **Import Vitest**: `import { describe, it, expect } from "vitest"`
3. **Add header comment**: Explain what the test validates and why it matters
4. **Write tests**: Use `describe` blocks to group related tests
5. **Run tests**: `pnpm test:watch` to see results in real-time

**Example**:
```typescript
/**
 * Feature Name Tests
 * 
 * Brief description of what this validates and why it matters.
 */

import { describe, it, expect } from "vitest";
import { functionToTest } from "@/lib/path/to/module";

describe("feature name", () => {
  it("should do something correctly", () => {
    const result = functionToTest(input);
    expect(result).toBe(expected);
  });
});
```

## Test Philosophy

These unit tests focus on **golden rules** - critical invariants that must never break:

1. **Coordinate conversion must be deterministic** - Same input always produces same output
2. **Workspace resolution must be consistent** - Cookies → Users Sheet → Error
3. **Gmail operations must be idempotent** - Repeated operations are safe
4. **Templates must store only PDF points** - No percentage fallback
5. **Preconditions must be validated** - Fail fast with clear errors

These are **not** integration tests. They test business logic in isolation with mocks.

## CI/CD Integration

Tests run automatically in CI/CD pipelines. All tests must pass before deployment.

```bash
# CI command
pnpm test
```

## Troubleshooting

**Tests fail after code changes**:
- Check if you modified core business logic
- Verify mocks are still valid
- Ensure test data matches new requirements

**Tests pass but production fails**:
- Unit tests don't cover integration scenarios
- Check `TESTING_GUIDE.md` for integration test procedures
- Verify environment variables and external dependencies

**Slow test execution**:
- Tests should run in < 1 second total
- If slow, check for unnecessary async operations
- Ensure mocks are used instead of real API calls

