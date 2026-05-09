import assert from "node:assert/strict";
import test from "node:test";

import {
  detectWakePhrase,
  detectWakePhraseFromAudio,
  normalizeWakeTranscript,
} from "../../apps/server/src/voice/wake-detection.ts";

test("normalizeWakeTranscript removes casing and punctuation", () => {
  assert.equal(normalizeWakeTranscript("Hey, Murmur!"), "hey murmur");
});

test("detectWakePhrase accepts configured wake variants", () => {
  assert.equal(detectWakePhrase("Hey, Murmur."), true);
  assert.equal(detectWakePhrase("hi murmur"), true);
  assert.equal(detectWakePhrase("Okay Murmur"), true);
  assert.equal(detectWakePhrase("ok, murmur"), true);
});

test("detectWakePhrase rejects non-wake transcripts", () => {
  assert.equal(detectWakePhrase("open my calendar"), false);
  assert.equal(detectWakePhrase("murmur is a desktop assistant"), false);
});

test("detectWakePhraseFromAudio returns only wake match state and transcript internally", async () => {
  const result = await detectWakePhraseFromAudio(["AAAA"], {
    apiKey: "elevenlabs-test-key",
    transcribe: async () => "Hey Murmur",
  });

  assert.deepEqual(result, {
    detected: true,
    transcript: "Hey Murmur",
  });
});
