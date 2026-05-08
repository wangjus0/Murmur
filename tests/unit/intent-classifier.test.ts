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

test("classifyIntent answers multi-operator arithmetic with precedence locally", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "What is three plus three times two?"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.95,
    query: "What is three plus three times two?",
    answer: "The answer is 9.",
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

test("classifyIntent routes URL definition questions to quick answer", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "what is a URL?"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.72,
    query: "what is a URL?",
    needs_web_search: false,
  });
});

test("classifyIntent routes advice questions to quick answer", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "How should I structure a TypeScript Supabase project?"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.72,
    query: "How should I structure a TypeScript Supabase project?",
    needs_web_search: false,
  });
});

test("classifyIntent routes general comparisons to quick answer", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "Compare React and Vue for a beginner project"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.72,
    query: "Compare React and Vue for a beginner project",
    needs_web_search: false,
  });
});

test("classifyIntent keeps explicit web retrieval on search path", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "search for Murmur demo projects"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "search",
    confidence: 0.72,
    query: "search for Murmur demo projects",
  });
});

test("classifyIntent keeps browser actions on search path", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "Can you open google.com and search for Murmur demo projects?"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "search",
    confidence: 0.72,
    query: "Can you open google.com and search for Murmur demo projects?",
  });
});

test("classifyIntent ignores leading speech fillers before browser actions", async () => {
  let calls = 0;
  const request = "Uh, could you go to YouTube, and then search up UCSD, and then click on the first video?";
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    request
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "search",
    confidence: 0.72,
    query: request,
  });
});

test("classifyIntent keeps explicit Browser Use requests on browser search path", async () => {
  let calls = 0;
  const request = "Can you use browser use to open YouTube and then, uh, search UCSD and click on the first video? (clicks)";
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    request
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "search",
    confidence: 0.72,
    query: request,
  });
});

test("classifyIntent treats informational Browser Use questions as quick answers", async () => {
  let calls = 0;
  const result = await classifyIntent(
    createFailingAi(() => { calls += 1; }),
    "what is Browser Use?"
  );

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    intent: "quick_answer",
    confidence: 0.72,
    query: "what is Browser Use?",
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
