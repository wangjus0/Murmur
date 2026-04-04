import assert from "node:assert/strict";
import test from "node:test";

import {
  readSupabasePublicConfig,
  type SupabasePublicConfig,
} from "../../electron/supabaseConfig.ts";

function buildEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    SUPABASE_URL: "https://murmur.supabase.co",
    SUPABASE_ANON_KEY: "anon-test-key",
    ...overrides,
  };
}

test("readSupabasePublicConfig returns the public config values", () => {
  const config = readSupabasePublicConfig(buildEnv());
  const expected: SupabasePublicConfig = {
    url: "https://murmur.supabase.co",
    anonKey: "anon-test-key",
  };

  assert.deepEqual(config, expected);
});

test("readSupabasePublicConfig throws when SUPABASE_URL is missing", () => {
  assert.throws(
    () => readSupabasePublicConfig(buildEnv({ SUPABASE_URL: undefined })),
    /SUPABASE_URL/,
  );
});

test("readSupabasePublicConfig throws when SUPABASE_URL is not a valid URL", () => {
  assert.throws(
    () => readSupabasePublicConfig(buildEnv({ SUPABASE_URL: "not-a-url" })),
    /valid URL/,
  );
});

test("readSupabasePublicConfig throws when SUPABASE_URL does not use http/https", () => {
  assert.throws(
    () => readSupabasePublicConfig(buildEnv({ SUPABASE_URL: "ftp://murmur.supabase.co" })),
    /http or https/,
  );
});

test("readSupabasePublicConfig throws when SUPABASE_ANON_KEY is missing", () => {
  assert.throws(
    () => readSupabasePublicConfig(buildEnv({ SUPABASE_ANON_KEY: undefined })),
    /SUPABASE_ANON_KEY/,
  );
});
