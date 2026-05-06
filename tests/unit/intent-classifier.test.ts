import assert from "node:assert/strict";
import test from "node:test";

import type { AiClient } from "../../apps/server/src/config/ai-client.ts";
import { classifyIntent } from "../../apps/server/src/orchestrator/intent.ts";

function createFailingAi(onCall: () => void): AiClient {
  return {
    models: {
      generateContent: async () => {
        onCall();
        throw new Error("OpenRouter should not be called by classifyIntent");
      },
    },
  } as AiClient;
}

test("classifyIntent answers simple arithmetic without OpenRouter", async () => {
  let calls = 0;
  const result = await classifyIntent(createFailingAi(() => { calls += 1; }), "What is one plus one?");

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.95,
    query: "What is one plus one?",
    answer: "The answer is 2.",
    needs_web_search: false,
  });
});

test("classifyIntent routes live lookups to quick web search without OpenRouter", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "what is the weather in San Francisco today?"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.72,
    query: "what is the weather in San Francisco today?",
    needs_web_search: true,
  });
});

test("classifyIntent routes general knowledge questions to quick answer", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "what is the capital of France?"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.72,
    query: "what is the capital of France?",
    needs_web_search: false,
  });
});

test("classifyIntent handles conversational acknowledgements locally", async () => {
  let calls = 0;
  const result = await classifyIntent(createFailingAi(() => { calls += 1; }), "That's great.");

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.95,
    query: "That's great.",
    answer: "Glad that helped.",
    needs_web_search: false,
  });
});

test("classifyIntent detects form fill requests locally", async () => {
  let calls = 0;
  const result = await classifyIntent(createFailingAi(() => { calls += 1; }), "fill something out for me");

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "form_fill_draft",
    confidence: 0.72,
    query: "fill something out for me",
  });
});

test("classifyIntent asks for clarification on ambiguous references", async () => {
  let calls = 0;
  const result = await classifyIntent(createFailingAi(() => { calls += 1; }), "search for it");

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "clarify",
    confidence: 0.95,
    query: "search for it",
    clarification: "What should I work on?",
  });
});
