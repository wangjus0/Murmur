import assert from "node:assert/strict";
import test from "node:test";
import { parseOAuthCallback } from "../../apps/client/src/features/auth/oauth.ts";

test("parseOAuthCallback extracts code for expected callback URL", () => {
  const result = parseOAuthCallback("murmur://auth/callback?code=abc123");
  assert.deepEqual(result, { type: "success", code: "abc123" });
});

test("parseOAuthCallback returns ignored for unrelated URL", () => {
  const result = parseOAuthCallback("https://example.com/callback?code=abc123");
  assert.deepEqual(result, { type: "ignored" });
});

test("parseOAuthCallback returns error for callback failures", () => {
  const result = parseOAuthCallback("murmur://auth/callback?error=access_denied");
  assert.deepEqual(result, { type: "error", message: "access_denied" });
});

test("parseOAuthCallback returns OTP token hash for password recovery", () => {
  const result = parseOAuthCallback("murmur://auth/callback?type=recovery&token_hash=tok_123");
  assert.deepEqual(result, { type: "otp", tokenHash: "tok_123", otpType: "recovery" });
});

test("parseOAuthCallback returns OTP token hash for signup verification", () => {
  const result = parseOAuthCallback("murmur://auth/callback?type=signup&token_hash=tok_signup");
  assert.deepEqual(result, { type: "otp", tokenHash: "tok_signup", otpType: "signup" });
});

test("parseOAuthCallback returns session tokens from hash payload", () => {
  const result = parseOAuthCallback("murmur://auth/callback#access_token=a&refresh_token=b");
  assert.deepEqual(result, { type: "session", accessToken: "a", refreshToken: "b" });
});
