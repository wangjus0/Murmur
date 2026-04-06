import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { IntentResult } from "@murmur/shared";

const intentResultSchema = z.object({
  intent: z.enum(["search", "form_fill_draft", "clarify", "web_extract", "multi_site_compare", "quick_answer"]),
  confidence: z.number().min(0).max(1),
  query: z.string(),
  // Gemini may return explicit null for optional fields when they are not
  // applicable — use .nullish() (= null | undefined | string) then normalize
  // null → undefined so the rest of the code only ever sees string | undefined.
  clarification: z.string().nullish(),
  answer: z.string().nullish(),
  needs_web_search: z.boolean().nullish(),
});

const SYSTEM_PROMPT = `You are an intent classifier for a voice-controlled browser agent.
Classify the user's speech into exactly ONE of these intents:

- "quick_answer": The user is asking something that can be answered without a full browser session.
  Two sub-cases:
  1. Answerable from your own knowledge (jokes, trivia, math, definitions, conversational): set needs_web_search=false and fill the "answer" field.
  2. Needs a live web lookup but NOT a full browser session — current weather, live stock prices, sports scores, today's news headlines, current exchange rates, recent events: set needs_web_search=true and leave "answer" empty. A fast search will be run for you.
- "search": The user wants to browse, navigate, or interact with the web in a way that requires a full browser (clicking, logging in, complex multi-step navigation, form interaction beyond simple lookup).
- "form_fill_draft": The user wants to fill out a form on a website. Draft only — never submit.
- "web_extract": The user wants to read, extract, or summarize a specific webpage (URL provided or implied).
- "multi_site_compare": The user wants to compare information across multiple websites.
- "clarify": The request is missing critical information. Use when the task cannot be reasonably inferred — "book a flight" (no destination), "send an email" (no recipient), "search for it" (no subject). You MUST include a short, specific question in the "clarification" field.

## needs_web_search decision guide
Set needs_web_search=true (and intent="quick_answer") when the question is:
- A simple factual lookup that changes over time: weather, stock prices, sports scores, exchange rates, news, "what movies are showing", "what's the temperature in X"
- Answerable with a short web search result, NOT requiring clicking/logging in/navigating pages

Set needs_web_search=false (and intent="quick_answer") when:
- You can answer from training data: math, definitions, jokes, historical facts, general knowledge

Use intent="search" (not quick_answer) when the task requires interacting with a website, logging in, or multi-step navigation.

IMPORTANT: When intent is "clarify", the "clarification" field is required and must contain a single, specific question to ask the user.

Respond with JSON only:
{
  "intent": "quick_answer" | "search" | "form_fill_draft" | "web_extract" | "multi_site_compare" | "clarify",
  "confidence": 0.0 to 1.0,
  "query": "the original user text",
  "clarification": "required when intent is clarify — one specific question",
  "answer": "direct answer if intent is quick_answer and needs_web_search is false",
  "needs_web_search": true | false
}`;

const FALLBACK: IntentResult = {
  intent: "search",
  confidence: 0.5,
  query: "",
};

function inferIntentFromTranscript(transcript: string): IntentResult["intent"] {
  const text = transcript.toLowerCase();

  const compareSignals =
    /\b(compare|comparison|versus|vs\.?|better than|difference between)\b/.test(text) &&
    /\b(and|vs|versus|between)\b/.test(text);
  if (compareSignals) {
    return "multi_site_compare";
  }

  const webExtractSignals =
    /\b(read|extract|summarize|summary|what does this page say|from this page|on this page)\b/.test(
      text
    ) && /(https?:\/\/|website|webpage|page|site)/.test(text);
  if (webExtractSignals) {
    return "web_extract";
  }

  const formSignals =
    /\b(fill|form|sign up|signup|register|apply|enter my|submit application|contact form)\b/.test(
      text
    );
  if (formSignals) {
    return "form_fill_draft";
  }

  return "search";
}

export async function classifyIntent(
  ai: GoogleGenAI,
  transcript: string,
  historyContext?: string
): Promise<IntentResult> {
  try {
    const contextPrefix = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${SYSTEM_PROMPT}\n\n${contextPrefix}User said: "${transcript}"`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) {
      return {
        ...FALLBACK,
        intent: inferIntentFromTranscript(transcript),
        query: transcript,
      };
    }

    const parsed = intentResultSchema.parse(JSON.parse(text));

    // Normalize nullish fields — Gemini may return explicit null for optional
    // fields that don't apply (e.g. "answer": null when needs_web_search=true).
    const normalized: IntentResult = {
      intent: parsed.intent,
      confidence: parsed.confidence,
      query: transcript,
      ...(parsed.clarification != null ? { clarification: parsed.clarification } : {}),
      ...(parsed.answer != null ? { answer: parsed.answer } : {}),
      ...(parsed.needs_web_search != null
        ? { needs_web_search: parsed.needs_web_search }
        : {}),
    };

    // Trust the model's clarify classification — the orchestrator handles the fallback question.
    if (normalized.intent === "clarify") {
      return normalized;
    }

    // For non-clarify intents, fall back to rule-based inference when confidence is low.
    const inferredIntent = inferIntentFromTranscript(transcript);
    if (normalized.confidence < 0.6) {
      return {
        intent: inferredIntent,
        confidence: Math.max(normalized.confidence, 0.51),
        query: transcript,
      };
    }

    return normalized;
  } catch (err) {
    console.error("[Intent] Classification failed:", err);
    return {
      ...FALLBACK,
      intent: inferIntentFromTranscript(transcript),
      query: transcript,
    };
  }
}
