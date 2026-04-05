import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRedirectConfigurationError,
  isRedirectConfigurationError,
} from "../../apps/client/src/features/auth/redirect.ts";

test("isRedirectConfigurationError detects Supabase redirect allowlist errors", () => {
  assert.equal(isRedirectConfigurationError("email_redirect_to is not allowed"), true);
  assert.equal(isRedirectConfigurationError("Redirect URL not allowlisted"), true);
  assert.equal(isRedirectConfigurationError("Provided redirect is not allowed"), true);
});

test("isRedirectConfigurationError ignores non-redirect auth errors", () => {
  assert.equal(isRedirectConfigurationError("Invalid login credentials"), false);
});

test("buildRedirectConfigurationError returns actionable setup message", () => {
  const message = buildRedirectConfigurationError("murmur://auth/callback");
  assert.match(message, /not allowlisted/i);
  assert.match(message, /murmur:\/\/auth\/callback/);
});
