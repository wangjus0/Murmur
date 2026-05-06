import assert from "node:assert/strict";
import test from "node:test";

import type { ServerEvent } from "@murmur/shared";
import { narrate } from "../../apps/server/src/voice/narrator.ts";

test("narrate sends text and swallows TTS failures", async () => {
  const events: ServerEvent[] = [];

  await narrate(
    { send: (event) => events.push(event) },
    "Paris is the capital of France.",
    "elevenlabs-test-key",
    undefined,
    () => ({
      synthesize: async () => {
        throw new Error("TTS unavailable");
      },
    })
  );

  assert.deepEqual(events, [
    { type: "narration_text", text: "Paris is the capital of France." },
  ]);
});
