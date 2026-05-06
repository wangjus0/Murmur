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

test("short follow-up uses context resolution before browser routing", async () => {
  const session = new FakeSession();
  const browserCalls: string[] = [];
  let aiCalls = 0;

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        return { text: JSON.stringify({ resolved: "search for Murmur demo projects next week" }) };
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "next week?",
    {
      summary: null,
      recentTurns: [{ transcript: "search for Murmur demo projects", response: "Found 3 demos." }],
    },
    {
      classifyIntent: async (_ai, transcript) => ({
        intent: "search",
        confidence: 0.8,
        query: transcript,
      }),
      createBrowserAdapter: () => ({
        runSearch: async (query) => {
          browserCalls.push(query);
          return "1. Murmur demo next week";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      tavilyApiKey: "",
      enableOutputRefinement: false,
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 1);
  assert.deepEqual(browserCalls, ["search for Murmur demo projects next week"]);
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
          callbacks.onBrowserView?.({
            sessionId: "sess_live_preview",
            status: "running",
            liveUrl: "https://live.browser-use.com/sess_live_preview",
            stepCount: 1,
            lastStepSummary: "Opened search results",
            isTaskSuccessful: null,
          });
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
  assert.deepEqual(narratedTexts, [
    "I navigated to search results.\n1. Demo Project - https://example.com/demo",
  ]);
  assert.equal(session.browserAdapter, null);

  assert.deepEqual(
    session.events.map((event) => event.type),
    ["intent", "action_status", "browser_view", "narration_text", "done"]
  );

  const actionStatuses = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "action_status" }> =>
      event.type === "action_status"
  );
  assert.equal(actionStatuses.length, 1);
  assert.equal(actionStatuses[0].message, "Opened search results");

  const browserViews = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "browser_view" }> =>
      event.type === "browser_view"
  );
  assert.equal(browserViews.length, 1);
  assert.equal(browserViews[0].liveUrl, "https://live.browser-use.com/sess_live_preview");
});

test("browser output keeps full display text while shortening spoken summary", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  const spokenTexts: Array<string | undefined> = [];
  const rawOutput = Array.from({ length: 15 }, (_, index) => `${index + 1}. Result ${index + 1}`).join("\n");

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
        runSearch: async () => rawOutput,
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      refineOutput: async () => {
        throw new Error("Output refinement should not run");
      },
      narrate: async (narrationSession, text, _apiKey, spokenText) => {
        narratedTexts.push(text);
        spokenTexts.push(spokenText);
        narrationSession.send({ type: "narration_text", text });
      },
      enableOutputRefinement: false,
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.deepEqual(narratedTexts, [rawOutput]);
  assert.deepEqual(spokenTexts, [
    Array.from({ length: 12 }, (_, index) => `${index + 1}. Result ${index + 1}`).join("\n"),
  ]);
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

test("live integration lookup routes to integration before quick-answer Tavily path", async () => {
  const session = new FakeSession();
  let aiCalls = 0;
  let fastSearchCalls = 0;
  const browserOptions: Array<{
    preferredToolId?: string;
    forceIntegration?: boolean;
    integrationInstruction?: string;
  }> = [];

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        throw new Error("Tool guide should not run for deterministic integration matches");
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "latest emails",
    undefined,
    {
      createBrowserAdapter: () => ({
        runSearch: async (_query, callbacks, options) => {
          browserOptions.push({
            preferredToolId: options?.preferredToolId,
            forceIntegration: options?.forceIntegration,
            integrationInstruction: options?.integrationInstruction,
          });
          callbacks.onStatus("Opened Gmail integration");
          return "Inbox: 2 unread emails.";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      fastSearch: async () => {
        fastSearchCalls += 1;
        return null;
      },
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      tavilyApiKey: "tavily-test-key",
      enableOutputRefinement: false,
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 0);
  assert.equal(fastSearchCalls, 0);
  assert.deepEqual(browserOptions, [
    {
      preferredToolId: "gmail",
      forceIntegration: true,
      integrationInstruction:
        "Can you use the gmail integration and tell me what my most recent emails are",
    },
  ]);
});

test("private integration-like lookup runs tool guide before Tavily fallback", async () => {
  const session = new FakeSession();
  const narratedTexts: string[] = [];
  let aiCalls = 0;
  let fastSearchCalls = 0;
  const browserOptions: Array<{
    preferredToolId?: string;
    forceIntegration?: boolean;
    integrationInstruction?: string;
  }> = [];

  const ai = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        return {
          text: JSON.stringify({
            strategy: "integration_direct",
            integrations: ["Google Calendar"],
            enhanced_prompt: "Check calendar meetings for tomorrow.",
            reasoning: "This asks about the user's private meeting agenda.",
          }),
        };
      },
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "what meetings do I have tomorrow",
    undefined,
    {
      createBrowserAdapter: () => ({
        runSearch: async (query, callbacks, options) => {
          assert.equal(query, "Check calendar meetings for tomorrow.");
          browserOptions.push({
            preferredToolId: options?.preferredToolId,
            forceIntegration: options?.forceIntegration,
            integrationInstruction: options?.integrationInstruction,
          });
          callbacks.onStatus("Opened calendar integration");
          return "Calendar: Standup at 9 AM.";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      fastSearch: async () => {
        fastSearchCalls += 1;
        return null;
      },
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      tavilyApiKey: "tavily-test-key",
      enableLlmToolGuide: false,
      enableOutputRefinement: false,
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(aiCalls, 1);
  assert.equal(fastSearchCalls, 0);
  assert.deepEqual(browserOptions, [
    {
      preferredToolId: "google_calendar",
      forceIntegration: true,
      integrationInstruction:
        "Can you use the google calendar integration and what meetings do i have tomorrow",
    },
  ]);
  assert.deepEqual(session.states, ["thinking", "acting", "speaking", "idle"]);
  assert.deepEqual(narratedTexts, ["Calendar: Standup at 9 AM."]);
});

test("integration-assisted tool plan keeps browser live preview events", async () => {
  const session = new FakeSession();
  const browserOptions: Array<{
    preferredToolId?: string;
    forceIntegration?: boolean;
    integrationInstruction?: string;
  }> = [];

  const ai = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          strategy: "integration_assisted",
          integrations: ["Exa"],
          enhanced_prompt: "Use Exa to find official Murmur docs, then open the best result.",
          reasoning: "Exa can identify candidate pages before browser navigation.",
        }),
      }),
    },
  } as unknown as GoogleGenAI;

  await handleTranscriptFinal(
    session,
    ai,
    "elevenlabs-test-key",
    "find official Murmur docs and open the best result",
    undefined,
    {
      classifyIntent: async () => ({
        intent: "search",
        confidence: 0.94,
        query: "find official Murmur docs and open the best result",
      }),
      createBrowserAdapter: () => ({
        runSearch: async (query, callbacks, options) => {
          assert.equal(
            query,
            "Use Exa to find official Murmur docs, then open the best result."
          );
          browserOptions.push({
            preferredToolId: options?.preferredToolId,
            forceIntegration: options?.forceIntegration,
            integrationInstruction: options?.integrationInstruction,
          });
          callbacks.onStatus("Opened browser result");
          callbacks.onBrowserView?.({
            sessionId: "sess_assisted_preview",
            status: "running",
            liveUrl: "https://live.browser-use.com/sess_assisted_preview",
          });
          return "Opened official docs.";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      narrate: async (narrationSession, text) => {
        narrationSession.send({ type: "narration_text", text });
      },
      enableLlmToolGuide: true,
      enableOutputRefinement: false,
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.deepEqual(browserOptions, [
    {
      preferredToolId: "exa",
      forceIntegration: true,
      integrationInstruction:
        "Can you use the exa integration and find official murmur docs and open the best result",
    },
  ]);

  const browserViews = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "browser_view" }> =>
      event.type === "browser_view"
  );
  assert.equal(browserViews.length, 1);
  assert.equal(browserViews[0].liveUrl, "https://live.browser-use.com/sess_assisted_preview");
});

test("read-only search falls back to Browser Use when Tavily is unavailable", async () => {
  const session = new FakeSession();
  const browserCalls: string[] = [];
  const narratedTexts: string[] = [];
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
        runSearch: async (query, callbacks) => {
          browserCalls.push(query);
          callbacks.onStatus("Opened search results");
          return "I navigated to search results.\n1. Demo Project - https://example.com/demo";
        },
        runFormFillDraft: async () => {
          throw new Error("Unexpected form fill path");
        },
      }),
      fastSearch: async () => {
        fastSearchCalls += 1;
        return null;
      },
      refineOutput: async () => {
        refineCalls += 1;
        return { displayText: "unexpected", spokenSummary: "unexpected" };
      },
      narrate: async (narrationSession, text) => {
        narratedTexts.push(text);
        narrationSession.send({ type: "narration_text", text });
      },
      tavilyApiKey: "",
      enableOutputRefinement: false,
      browserApiKey: "browser-use-test-key",
    }
  );

  assert.equal(fastSearchCalls, 0);
  assert.deepEqual(browserCalls, ["search for Murmur demo projects"]);
  assert.equal(refineCalls, 0);
  assert.deepEqual(session.states, ["thinking", "acting", "speaking", "idle"]);
  assert.deepEqual(narratedTexts, [
    "I navigated to search results.\n1. Demo Project - https://example.com/demo",
  ]);
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
          callbacks.onBrowserView?.({
            sessionId: "sess_integration_preview",
            status: "running",
            liveUrl: "https://live.browser-use.com/sess_integration_preview",
          });
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

  const browserViews = session.events.filter(
    (event): event is Extract<ServerEvent, { type: "browser_view" }> =>
      event.type === "browser_view"
  );
  assert.equal(browserViews.length, 0);
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
