import test from "node:test";
import assert from "node:assert/strict";

import {
  createPolicyConfig,
  evaluateIntentPolicy,
  evaluatePolicyAction,
} from "../../apps/server/src/safety/policy.ts";

test("allows navigation for allowlisted domains", () => {
  const decision = evaluatePolicyAction(
    {
      kind: "navigate",
      targetUrl: "https://www.google.com/search?q=murmur",
    },
    createPolicyConfig("google.com,example.com")
  );

  assert.equal(decision.allowed, true);
});

test("blocks navigation for non-allowlisted domains", () => {
  const decision = evaluatePolicyAction(
    {
      kind: "navigate",
      targetUrl: "https://phishing.example.net",
    },
    createPolicyConfig("google.com,example.com")
  );

  assert.equal(decision.allowed, false);
  if (decision.allowed) {
    return;
  }

  assert.equal(decision.reason, "domain_not_allowlisted");
});

test("blocks dangerous payment and checkout actions", () => {
  const decision = evaluatePolicyAction(
    {
      kind: "pay",
      query: "pay for this order",
    },
    createPolicyConfig("google.com")
  );

  assert.equal(decision.allowed, false);
  if (decision.allowed) {
    return;
  }

  assert.equal(decision.reason, "dangerous_action");
});

test("never allows final form submission in form_fill_draft", () => {
  const decision = evaluateIntentPolicy(
    {
      intent: "form_fill_draft",
      confidence: 0.99,
      query: "fill my address and submit the form",
    },
    createPolicyConfig("google.com")
  );

  assert.equal(decision.allowed, false);
  if (decision.allowed) {
    return;
  }

  assert.equal(decision.reason, "final_form_submission_blocked");
});

test("allows final form submission when explicitly enabled", () => {
  const decision = evaluateIntentPolicy(
    {
      intent: "form_fill_draft",
      confidence: 0.99,
      query: "fill this form and submit for me",
    },
    createPolicyConfig("google.com", true)
  );

  assert.equal(decision.allowed, true);
});

test("blocks search navigation when query contains non-allowlisted bare domain", () => {
  const decision = evaluateIntentPolicy(
    {
      intent: "search",
      confidence: 0.98,
      query: "go to paypal.com and show login options",
    },
    createPolicyConfig("google.com,example.com")
  );

  assert.equal(decision.allowed, false);
  if (decision.allowed) {
    return;
  }

  assert.equal(decision.reason, "domain_not_allowlisted");
});
