import assert from "node:assert/strict";
import test from "node:test";

import { booleanEnv } from "../../apps/server/src/config/boolean-env.ts";

test("booleanEnv parses explicit env flag strings", () => {
  const schema = booleanEnv(false);

  assert.equal(schema.parse(undefined), false);
  assert.equal(schema.parse("true"), true);
  assert.equal(schema.parse("TRUE"), true);
  assert.equal(schema.parse("1"), true);
  assert.equal(schema.parse("false"), false);
  assert.equal(schema.parse("FALSE"), false);
  assert.equal(schema.parse("0"), false);
});

test("booleanEnv applies the configured default only when unset", () => {
  const schema = booleanEnv(true);

  assert.equal(schema.parse(undefined), true);
  assert.equal(schema.parse("false"), false);
});

test("booleanEnv rejects ambiguous truthy strings", () => {
  const schema = booleanEnv(false);

  assert.throws(() => schema.parse("yes"), /Expected one of/);
});
