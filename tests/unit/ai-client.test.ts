import assert from "node:assert/strict";
import test from "node:test";

import { createAiClient } from "../../apps/server/src/config/ai-client.ts";

test("createAiClient uses OpenRouter free models router", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "{\"answer\":\"ok\"}" } }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const ai = createAiClient("openrouter-test-key");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Return JSON.",
      config: { responseMimeType: "application/json" },
    });

    assert.equal(response.text, "{\"answer\":\"ok\"}");
    assert.equal(capturedBody?.model, "openrouter/free");
    assert.deepEqual(capturedBody?.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAiClient uses configured model fallback list and max tokens", async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies: Record<string, unknown>[] = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capturedBodies.push(body);

    if (body.model === "free-a") {
      return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "{\"answer\":\"ok\"}" } }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const ai = createAiClient("openrouter-test-key", {
      models: "free-a, free-b",
      timeoutMs: 1000,
    });
    const response = await ai.models.generateContent({
      model: "quick-answer",
      contents: "Return JSON.",
      config: { responseMimeType: "application/json", maxTokens: 32 },
    });

    assert.equal(response.text, "{\"answer\":\"ok\"}");
    assert.deepEqual(
      capturedBodies.map((body) => body.model),
      ["free-a", "free-b"]
    );
    assert.equal(capturedBodies[1]?.max_tokens, 32);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
