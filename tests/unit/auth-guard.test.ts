import assert from "node:assert/strict";
import test from "node:test";
import { resolveGuardDestination } from "../../apps/client/src/features/auth/guard.ts";

test("resolveGuardDestination returns auth when user is null", () => {
  const destination = resolveGuardDestination(null);
  assert.equal(destination, "auth");
});

test("resolveGuardDestination returns onboarding when onboarding flag is missing", () => {
  const destination = resolveGuardDestination({ user_metadata: {} } as any);
  assert.equal(destination, "onboarding");
});

test("resolveGuardDestination returns home when onboarding_completed is true", () => {
  const destination = resolveGuardDestination({ user_metadata: { onboarding_completed: true } } as any);
  assert.equal(destination, "home");
});
