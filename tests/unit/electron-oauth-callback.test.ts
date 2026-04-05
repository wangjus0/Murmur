import assert from "node:assert/strict";
import test from "node:test";
import { PendingOAuthCallbackStore, normalizeOAuthCallbackUrl } from "../../electron/oauthCallback.ts";

test("normalizeOAuthCallbackUrl accepts standard callback URL", () => {
  const result = normalizeOAuthCallbackUrl("murmur://auth/callback?code=abc123");
  assert.equal(result, "murmur://auth/callback?code=abc123");
});

test("normalizeOAuthCallbackUrl normalizes trailing callback slash", () => {
  const result = normalizeOAuthCallbackUrl("murmur://auth/callback/?code=abc123");
  assert.equal(result, "murmur://auth/callback?code=abc123");
});

test("normalizeOAuthCallbackUrl normalizes root auth path", () => {
  const result = normalizeOAuthCallbackUrl("murmur://auth/?type=email&token_hash=tok_1");
  assert.equal(result, "murmur://auth/callback?type=email&token_hash=tok_1");
});

test("normalizeOAuthCallbackUrl rejects non-auth callback URL", () => {
  const result = normalizeOAuthCallbackUrl("https://example.com/callback?code=abc123");
  assert.equal(result, null);
});

test("PendingOAuthCallbackStore stores only valid callback URLs", () => {
  const store = new PendingOAuthCallbackStore();

  const invalid = store.setFromRaw("https://example.com/callback?code=nope");
  assert.equal(invalid, null);
  assert.equal(store.peek(), null);

  const valid = store.setFromRaw("murmur://auth/callback?code=abc123");
  assert.equal(valid, "murmur://auth/callback?code=abc123");
  assert.equal(store.peek(), "murmur://auth/callback?code=abc123");
});

test("PendingOAuthCallbackStore consumes callback once", () => {
  const store = new PendingOAuthCallbackStore();
  store.setFromRaw("murmur://auth/callback?code=abc123");

  const firstConsume = store.consume();
  const secondConsume = store.consume();

  assert.equal(firstConsume, "murmur://auth/callback?code=abc123");
  assert.equal(secondConsume, null);
});
