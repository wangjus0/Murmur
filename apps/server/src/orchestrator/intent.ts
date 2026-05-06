import type { AiClient } from "../config/ai-client.js";
import type { IntentResult } from "@murmur/shared";

const BASE_CONFIDENCE = 0.72;
const HIGH_CONFIDENCE = 0.95;

const NUMBER_WORDS = new Map<string, number>([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
]);

const NUMBER_TOKEN_PATTERN =
  "-?\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";

const SIMPLE_ARITHMETIC_PATTERN = new RegExp(
  `^(?:what is|what's|whats|calculate|compute|solve|tell me)?\\s*` +
    `(?<left>${NUMBER_TOKEN_PATTERN})\\s*` +
    `(?<operator>\\+|plus|add|added to|-|minus|subtract|less|times|x|\\*|multiplied by|divided by|over|/)\\s*` +
    `(?<right>${NUMBER_TOKEN_PATTERN})\\s*$`,
  "i"
);

const LIVE_LOOKUP_PATTERN =
  /\b(weather|forecast|temperature|stock|share price|market price|exchange rate|sports score|score|news|headline|headlines|latest|current|right now|today|tomorrow|yesterday|this week|this month|price of)\b/i;

const NAVIGATION_PATTERN =
  /\b(https?:\/\/|website|webpage|open|go to|navigate|click|login|log in|sign in|buy|purchase|order|book|schedule)\b/i;

const QUICK_QUESTION_PATTERN =
  /\b(what is|what's|what are|who is|who's|who are|when is|when was|where is|where are|how do|how does|how many|how much|why is|why does|why are|tell me|explain|define|is it|are there|do you know|how old|how tall|how far|what time|what day|what year|joke|trivia|capital of|meaning of|history of|difference between)\b/i;

const CONVERSATIONAL_ACK_PATTERN =
  /^(?:that(?:'s| is)\s+)?(?:great|good|nice|awesome|perfect|cool|excellent|helpful|amazing|wonderful|fine|ok|okay)(?:\s+(?:thanks|thank you))?$|^(?:thanks|thank you|appreciate it)$/i;

function normalizeTranscript(transcript: string): string {
  return transcript
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.!?]+$/g, "").trim();
}

function parseNumberToken(token: string): number | null {
  const normalized = token.toLowerCase().trim();
  const wordValue = NUMBER_WORDS.get(normalized);
  if (wordValue !== undefined) {
    return wordValue;
  }

  const numericValue = Number(normalized);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(Number(value.toFixed(8)));
}

function answerSimpleArithmetic(transcript: string): string | null {
  const cleaned = stripTrailingPunctuation(normalizeTranscript(transcript).toLowerCase());
  const match = SIMPLE_ARITHMETIC_PATTERN.exec(cleaned);
  const groups = match?.groups;
  if (!groups) {
    return null;
  }

  const left = parseNumberToken(groups.left ?? "");
  const right = parseNumberToken(groups.right ?? "");
  const operator = groups.operator?.toLowerCase();
  if (left === null || right === null || !operator) {
    return null;
  }

  let result: number;
  switch (operator) {
    case "+":
    case "plus":
    case "add":
    case "added to":
      result = left + right;
      break;
    case "-":
    case "minus":
    case "subtract":
    case "less":
      result = left - right;
      break;
    case "*":
    case "x":
    case "times":
    case "multiplied by":
      result = left * right;
      break;
    case "/":
    case "over":
    case "divided by":
      if (right === 0) {
        return "I can't divide by zero.";
      }
      result = left / right;
      break;
    default:
      return null;
  }

  return `The answer is ${formatNumber(result)}.`;
}

function needsClarification(transcript: string): string | null {
  const text = stripTrailingPunctuation(normalizeTranscript(transcript).toLowerCase());

  if (!text) {
    return "What would you like me to do?";
  }

  if (
    /^(do|open|search|find|look up|check|click|show|summarize)(?:\s+for)?\s+(it|that|this|them|there)$/i.test(
      text
    ) ||
    /^(do it|help|please help|can you|could you)$/i.test(text)
  ) {
    return "What should I work on?";
  }

  return null;
}

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
  _ai: AiClient,
  transcript: string,
  _historyContext?: string
): Promise<IntentResult> {
  const normalized = normalizeTranscript(transcript);
  const clarification = needsClarification(normalized);
  if (clarification) {
    return {
      intent: "clarify",
      confidence: HIGH_CONFIDENCE,
      query: normalized,
      clarification,
    };
  }

  if (CONVERSATIONAL_ACK_PATTERN.test(stripTrailingPunctuation(normalized))) {
    return {
      intent: "quick_answer",
      confidence: HIGH_CONFIDENCE,
      query: normalized,
      answer: "Glad that helped.",
      needs_web_search: false,
    };
  }

  const arithmeticAnswer = answerSimpleArithmetic(normalized);
  if (arithmeticAnswer) {
    return {
      intent: "quick_answer",
      confidence: HIGH_CONFIDENCE,
      query: normalized,
      answer: arithmeticAnswer,
      needs_web_search: false,
    };
  }

  if (LIVE_LOOKUP_PATTERN.test(normalized) && !NAVIGATION_PATTERN.test(normalized)) {
    return {
      intent: "quick_answer",
      confidence: BASE_CONFIDENCE,
      query: normalized,
      needs_web_search: true,
    };
  }

  if (QUICK_QUESTION_PATTERN.test(normalized) && !NAVIGATION_PATTERN.test(normalized)) {
    return {
      intent: "quick_answer",
      confidence: BASE_CONFIDENCE,
      query: normalized,
      needs_web_search: false,
    };
  }

  return {
    intent: inferIntentFromTranscript(normalized),
    confidence: BASE_CONFIDENCE,
    query: normalized,
  };
}
