import assert from "node:assert/strict";
import test from "node:test";

import { useSessionStore } from "../../apps/client/src/store/session.ts";

test.beforeEach(() => {
  useSessionStore.getState().reset();
});

test("transcript final clears stale error state for a new turn", () => {
  useSessionStore.getState().setError("Previous model failure");

  useSessionStore.getState().addTranscriptFinal("what is the capital of France?");

  assert.equal(useSessionStore.getState().error, null);
});

test("narration text clears stale error state after a successful answer", () => {
  useSessionStore.getState().setError("Previous model failure");

  useSessionStore.getState().setNarrationText("Paris is the capital of France.");

  assert.equal(useSessionStore.getState().error, null);
});
