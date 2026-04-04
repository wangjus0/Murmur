import test from "node:test";
import assert from "node:assert/strict";

import { logPolicyBlock } from "../../apps/server/src/safety/policy.ts";

test("logPolicyBlock redacts raw query text", () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;

  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(" "));
  };

  try {
    const query = "my ssn is 123-45-6789";
    logPolicyBlock({
      reason: "dangerous_action",
      intent: "search",
      query,
    });

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /queryLength/);
    assert.doesNotMatch(warnings[0], /123-45-6789/);
    assert.doesNotMatch(warnings[0], /my ssn is/i);
  } finally {
    console.warn = originalWarn;
  }
});
