import test from "node:test";
import assert from "node:assert/strict";

import type { GoogleGenAI } from "@google/genai";
import type { ServerEvent } from "@murmur/shared";
import { handleTranscriptFinal } from "../../apps/server/src/orchestrator/orchestrator.ts";

class FakeSession {
  readonly events: ServerEvent[] = [];
  readonly states: Array<"idle" | "listening" | "thinking" | "acting" | "speaking"> = [];

  send(event: ServerEvent): void {
    this.events.push(event);
  }

  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void {
    this.states.push(state);
  }

  setBrowserAdapter(): void {
    // no-op for policy tests
  }
}

test("policy block emits safety status and never enters acting", async () => {
  const session = new FakeSession();
  const narrated: string[] = [];

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "fake-key",
    "please fill and submit this checkout form",
    undefined,
    "google.com",
    {
      classify: async () => ({
        intent: "form_fill_draft" as const,
        confidence: 0.99,
        query: "please fill and submit this checkout form",
      }),
      narrate: async (_session, text) => {
        narrated.push(text);
      },
    }
  );

  assert.equal(session.states.includes("acting"), false);

  const statusEvents = session.events.filter((event) => event.type === "action_status");
  assert.equal(statusEvents.length, 1);
  assert.match(statusEvents[0].message, /cannot submit|blocked/i);

  const doneEvents = session.events.filter((event) => event.type === "done");
  assert.equal(doneEvents.length, 1);

  assert.equal(narrated.length, 1);
  assert.match(narrated[0], /cannot submit|blocked/i);
});
