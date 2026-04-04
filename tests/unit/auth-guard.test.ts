import assert from "node:assert/strict";
import test from "node:test";
import { resolveGuardDestination } from "../../apps/client/src/features/auth/guard.ts";

test("resolveGuardDestination returns auth when user is null", () => {
  const destination = resolveGuardDestination(null, false);
  assert.equal(destination, "auth");
});

test("resolveGuardDestination returns onboarding when user exists and onboarding is incomplete", () => {
  const destination = resolveGuardDestination({} as any, false);
  assert.equal(destination, "onboarding");
});

test("resolveGuardDestination returns home when user exists and onboarding is complete", () => {
  const destination = resolveGuardDestination({} as any, true);
  assert.equal(destination, "home");
});
