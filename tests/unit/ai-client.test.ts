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
