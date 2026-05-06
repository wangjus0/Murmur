import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleGenAI } from "@google/genai";
import type { ServerEvent } from "@murmur/shared";

import { handleTranscriptFinal } from "../../apps/server/src/orchestrator/orchestrator.ts";

class FakeSession {
  readonly events: ServerEvent[] = [];
  readonly states: Array<"idle" | "listening" | "thinking" | "acting" | "speaking"> = [];
  browserAdapter: unknown = null;

  send(event: ServerEvent): void {
    this.events.push(event);
  }

  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void {
    this.states.push(state);
  }

  setBrowserAdapter(adapter: unknown): void {
    this.browserAdapter = adapter;
  }
}

test("quick arithmetic answer does not call OpenRouter or Browser Use", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  let aiCalls = 0;
  let browserCalls = 0;

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        throw new Error("OpenRouter should not be called for local quick answers");
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "What is one plus one?",
    undefined,
    {
      createBrowserAdapter: () => ({
        runSearch: async () => {
          browserCalls += 1;
          return "unexpected";
        },
        runFormFillDraft: async () => {
          browserCalls += 1;
          return "unexpected";
        },
      }),
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 0);
  assert.equal(browserCalls, 0);
  assert.deepEqual(session.states, ["thinking", "speaking", "idle"]);
  assert.deepEqual(narratedTexts, ["The answer is 2."]);
  assert.deepEqual(
    session.events.map((event) => event.type),
    ["intent", "narration_text", "done"]
  );
});

test("general quick answer uses one OpenRouter call and no browser path", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  let aiCalls = 0;
  let browserCalls = 0;

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        return { text: JSON.stringify({ answer: "Paris is the capital of France." }) };
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "what is the capital of France?",
    undefined,
    {
      createBrowserAdapter: () => ({
        runSearch: async () => {
          browserCalls += 1;
          return "unexpected";
        },
        runFormFillDraft: async () => {
          browserCalls += 1;
          return "unexpected";
        },
      }),
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 1);
  assert.equal(browserCalls, 0);
  assert.deepEqual(session.states, ["thinking", "speaking", "idle"]);
  assert.deepEqual(narratedTexts, ["Paris is the capital of France."]);
});

test("general quick answer rate limit returns fallback without browser path", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  let aiCalls = 0;
  let browserCalls = 0;

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        throw new Error("OpenRouter 429: upstream rate limited");
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "what is the capital of France?",
    undefined,
    {
      createBrowserAdapter: () => ({
        runSearch: async () => {
          browserCalls += 1;
          return "unexpected";
        },
        runFormFillDraft: async () => {
          browserCalls += 1;
          return "unexpected";
        },
      }),
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 1);
  assert.equal(browserCalls, 0);
  assert.deepEqual(session.states, ["thinking", "speaking", "idle"]);
  assert.deepEqual(narratedTexts, [
    "The quick-answer model is temporarily unavailable. Please try again in a moment.",
  ]);
});

test("conversational acknowledgement stays local and skips tool routing", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  let aiCalls = 0;
  let browserCalls = 0;

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        throw new Error("OpenRouter should not be called for acknowledgements");
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "That's great.",
    undefined,
    {
      createBrowserAdapter: () => ({
        runSearch: async () => {
          browserCalls += 1;
          return "unexpected";
        },
        runFormFillDraft: async () => {
          browserCalls += 1;
          return "unexpected";
        },
      }),
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 0);
  assert.equal(browserCalls, 0);
  assert.deepEqual(session.states, ["thinking", "speaking", "idle"]);
  assert.deepEqual(narratedTexts, ["Glad that helped."]);
});

test("conversational acknowledgement skips context resolution even with history", async () => {
  const session = new FakeSession();
  let aiCalls = 0;

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        throw new Error("Context resolution should not run for local acknowledgements");
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "That's great.",
    {
      summary: null,
      recentTurns: [{ transcript: "what is one plus one", response: "The answer is 2." }],
    },
    {
      createBrowserAdapter: () => ({
        runSearch: async () => "unexpected",
        runFormFillDraft: async () => "unexpected",
      }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 0);
});

test("referential follow-up uses context resolution before local quick answer", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  let aiCalls = 0;

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        return { text: JSON.stringify({ resolved: "what is one plus one" }) };
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "what about that one?",
    {
      summary: null,
      recentTurns: [{ transcript: "what is two plus two", response: "The answer is 4." }],
    },
    {
      createBrowserAdapter: () => ({
        runSearch: async () => "unexpected",
        runFormFillDraft: async () => "unexpected",
      }),
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 1);
  assert.deepEqual(narratedTexts, ["The answer is 2."]);
});

test("browser-required transcript flows through browser action, direct narration, and done", async () => {
  const session = new FakeSession();
  const browserCalls: string[] = [];
  const refineCalls: Array<{ userRequest: string; rawOutput: string }> = [];
  const narratedTexts: string[] = [];

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "open google.com and search for Murmur demo projects",
    undefined,
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "open google.com and search for Murmur demo projects",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (query, callbacks) => {
          browserCalls.push(query);
          callbacks.onStatus("Opened search results");
          return "I navigated to search results.\n1. Demo Project - https://example.com/demo";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      refineOutput: async (_ai, userRequest, rawOutput) => {
        refineCalls.push({ userRequest, rawOutput });
        return {
          displayText: "Top result: Demo Project - https://example.com/demo",
          spokenSummary: "Top result: Demo Project - https://example.com/demo",
        };
      },
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.deepEqual(session.states, ["thinking", "acting", "speaking", "idle"]);
  assert.deepEqual(browserCalls, ["open google.com and search for Murmur demo projects"]);
  assert.deepEqual(refineCalls, []);
  assert.deepEqual(narratedTexts, ["1. Demo Project - https://example.com/demo"]);
  assert.equal(session.browserAdapter, null);

  assert.deepEqual(
    session.events.map((event) => event.type),
    ["intent", "action_status", "narration_text", "done"]
  );

  const actionStatuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.equal(actionStatuses.length, 1);
  assert.equal(actionStatuses[0].message, "Opened search results");
});

test("read-only search uses fast Tavily path and skips Browser Use/refinement", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  let browserCalls = 0;
  let fastSearchCalls = 0;
  let refineCalls = 0;

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "search for Murmur demo projects",
    undefined,
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "search for Murmur demo projects",
      }),
      createBrowserAdapter: () => ({
        runSearch: async () => {
          browserCalls += 1;
          return "unexpected";
        },
        runFormFillDraft: async () => {
          browserCalls += 1;
          return "unexpected";
        },
      }),
      fastSearch: async (query, apiKey, onStatus) => {
        fastSearchCalls += 1;
        assert.equal(query, "search for Murmur demo projects");
        assert.equal(apiKey, "tavily-test-key");
        onStatus?.("Fast search finished");
        return {
          summary: "Top result: Demo Project - https://example.com/demo",
          results: [],
        };
      },
      refineOutput: async () => {
        refineCalls += 1;
        return { displayText: "unexpected", spokenSummary: "unexpected" };
      },
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      tavilyApiKey: "tavily-test-key",
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(fastSearchCalls, 1);
  assert.equal(browserCalls, 0);
  assert.equal(refineCalls, 0);
  assert.deepEqual(session.states, ["thinking", "acting", "speaking", "idle"]);
  assert.deepEqual(narratedTexts, ["Top result: Demo Project - https://example.com/demo"]);
});

test("deterministic integration routing skips LLM tool guide and uses browser integration path", async () => {
  const session = new FakeSession();
  const browserCalls: string[] = [];
  let selectToolCalls = 0;
  const browserOptions: Array<{
    preferredToolId?: string;
    selectedToolReason?: string;
    forceIntegration?: boolean;
    strictIntegration?: boolean;
    integrationInstruction?: string;
  }> = [];

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "check unread emails and summarize urgent ones",
    undefined,
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.91,
        query: "check unread emails and summarize urgent ones",
      }),
      selectTool: async () => {
        selectToolCalls += 1;
        throw new Error("LLM tool selection should not run by default");
      },
      createBrowserAdapter: () => ({
        runSearch: async (query, callbacks, options) => {
          browserCalls.push(query);
          browserOptions.push({
            preferredToolId: options?.preferredToolId,
            selectedToolReason: options?.selectedToolReason,
            forceIntegration: options?.forceIntegration,
            strictIntegration: options?.strictIntegration,
            integrationInstruction: options?.integrationInstruction,
          });
          callbacks.onStatus("Opened search results");
          return "1. Urgent message summary";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      refineOutput: async () => ({
        displayText: "Urgent summary: 1 message needs reply today.",
        spokenSummary: "Urgent summary: 1 message needs reply today.",
      }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.equal(selectToolCalls, 0);
  assert.deepEqual(browserCalls, ["check unread emails and summarize urgent ones"]);
  assert.deepEqual(browserOptions, [
    {
      preferredToolId: "gmail",
      selectedToolReason: undefined,
      forceIntegration: true,
      strictIntegration: undefined,
      integrationInstruction:
        "Can you use the gmail integration and check unread emails and summarize urgent ones",
    },
  ]);

  const actionStatuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.equal(actionStatuses.length, 1);
  assert.equal(actionStatuses[0].message, "Opened search results");
});

test("integration tool selection uses browser integration execution path", async () => {
  const session = new FakeSession();
  let searchCalls = 0;
  let formCalls = 0;

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "check my Gmail inbox for the latest three emails",
    undefined,
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "check my Gmail inbox for the latest three emails",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.9,
        reason: "gmail integration needed",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (_query, callbacks, options) => {
          searchCalls += 1;
          assert.equal(options?.preferredToolId, "gmail");
          assert.equal(options?.forceIntegration, true);
          assert.equal(options?.strictIntegration, undefined);
          assert.match(
            options?.integrationInstruction ?? "",
            /^Can you use the gmail integration and\s+/i
          );
          callbacks.onStatus("Executed integration search path");
          return "Latest three emails summarized.";
        },
        runFormFillDraft: async () => {
          formCalls += 1;
          return "Unexpected form path";
        },
      }),
      refineOutput: async () => ({
        displayText: "Latest three emails summarized.",
        spokenSummary: "Latest three emails summarized.",
      }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.equal(searchCalls, 1);
  assert.equal(formCalls, 0);
});

test("integration request uses server Browser Use key when user key is not provided", async () => {
  const session = new FakeSession();
  let browserCalled = false;

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "check my gmail inbox",
    undefined,
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.95,
        query: "check my gmail inbox",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.92,
        reason: "gmail integration needed",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (_query, callbacks) => {
          browserCalled = true;
          callbacks.onStatus("Executed integration path");
          return "unexpected";
        },
        runFormFillDraft: async () => {
          browserCalled = true;
          return "unexpected";
        },
      }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      refineOutput: async (_ai, _request, rawOutput) => ({
        displayText: rawOutput,
        spokenSummary: rawOutput,
      }),
      browserApiKey: "server-key",
      browserApiKeySource: "server",
    }
  );

  assert.equal(browserCalled, true);
  const statuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.ok(statuses.length >= 1);
});

test("clarify intent emits clarification request and remains idle", async () => {
  const session = new FakeSession();
  let searchCalls = 0;

  await handleTranscriptFinal(
    session,
    {} as GoogleGenAI,
    "elevenlabs-test-key",
    "do something with my inbox",
    undefined,
    {
      classifyIntent: async () => ({
        intent: "clarify",
        confidence: 0.2,
        query: "do something with my inbox",
        clarification: "What exactly should I do?",
      }),
      selectTool: async () => ({
        toolId: "gmail",
        confidence: 0.88,
        reason: "inbox request maps to gmail",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (_query, callbacks) => {
          searchCalls += 1;
          callbacks.onStatus("Executed best-effort integration search");
          return "Inbox summary";
        },
        runFormFillDraft: async () => "Unexpected form path",
      }),
      refineOutput: async () => ({ displayText: "Inbox summary", spokenSummary: "Inbox summary" }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      browserApiKey: "browser-use-test-key",
      browserApiKeySource: "user",
    }
  );

  assert.equal(searchCalls, 0);
  const clarificationEvents = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "clarification_request" }> =>
      event.type === "clarification_request"
  );
  assert.equal(clarificationEvents.length, 1);
  assert.equal(clarificationEvents[0].question, "What exactly should I do?");
});
