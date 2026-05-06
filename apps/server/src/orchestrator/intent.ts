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

type ArithmeticOperator = "+" | "-" | "*" | "/";

type ArithmeticToken =
  | { type: "number"; value: number }
  | { type: "operator"; value: ArithmeticOperator };

const ARITHMETIC_TOKEN_PATTERN = new RegExp(
  `\\s*(?:(?<number>${NUMBER_TOKEN_PATTERN})|(?<operator>\\+|-|\\*|/|\\b(?:added\\s+to|multiplied\\s+by|divided\\s+by|plus|add|minus|subtract|less|times|x|over)\\b))`,
  "iy"
);

const LIVE_LOOKUP_PATTERN =
  /\b(weather|forecast|temperature|stock|share price|market price|exchange rate|sports score|score|news|headline|headlines|latest|current|right now|today|tomorrow|yesterday|this week|this month|prices?|price of|near me|nearby)\b/i;

const BROWSER_TARGET_PATTERN =
  /\b(https?:\/\/|website|webpage)\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b|\b(?:this|that|the)\s+(?:page|site)\b/i;

const TOOL_ACTION_COMMAND_PATTERN =
  /^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:open|go to|navigate|click|login|log in|sign in|buy|purchase|order|book|schedule|send|reply|fill|submit|register|apply|download|upload)\b/i;

const EXTERNAL_RETRIEVAL_COMMAND_PATTERN =
  /^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:search(?:\s+the\s+web)?|look\s+up|google|browse|research)\b/i;

const QUICK_QUESTION_PATTERN =
  /\b(what is|what's|what are|what should|what would|who is|who's|who are|when is|when was|where is|where are|how do|how does|how can|how should|how would|how many|how much|why is|why does|why are|tell me|explain|define|describe|summarize|outline|list|give me|write|draft|brainstorm|recommend|suggest|compare|pros and cons|is it|are there|do you know|how old|how tall|how far|what time|what day|what year|joke|trivia|capital of|meaning of|history of|difference between)\b|\b(?:can|could|would|should|will|do|does|did|is|are|was|were)\s+(?:i|you|we|they|he|she|it|there|[a-z][\w'-]+)\b/i;

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

function requiresBrowserAutomation(transcript: string): boolean {
  return (
    BROWSER_TARGET_PATTERN.test(transcript) ||
    TOOL_ACTION_COMMAND_PATTERN.test(transcript)
  );
}

function requestsExternalRetrieval(transcript: string): boolean {
  return EXTERNAL_RETRIEVAL_COMMAND_PATTERN.test(transcript);
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

function normalizeArithmeticExpression(transcript: string): string {
  return stripTrailingPunctuation(normalizeTranscript(transcript).toLowerCase())
    .replace(/^(?:what is|what's|whats|calculate|compute|solve|tell me)\s+/, "")
    .trim();
}

function parseOperatorToken(token: string): ArithmeticOperator | null {
  switch (token.toLowerCase().replace(/\s+/g, " ")) {
    case "+":
    case "plus":
    case "add":
    case "added to":
      return "+";
    case "-":
    case "minus":
    case "subtract":
    case "less":
      return "-";
    case "*":
    case "x":
    case "times":
    case "multiplied by":
      return "*";
    case "/":
    case "over":
    case "divided by":
      return "/";
    default:
      return null;
  }
}

function tokenizeArithmeticExpression(expression: string): ArithmeticToken[] | null {
  const tokens: ArithmeticToken[] = [];
  let cursor = 0;

  while (cursor < expression.length) {
    ARITHMETIC_TOKEN_PATTERN.lastIndex = cursor;
    const match = ARITHMETIC_TOKEN_PATTERN.exec(expression);
    if (!match || match.index !== cursor || match[0].length === 0) {
      return null;
    }

    if (match.groups?.number) {
      const value = parseNumberToken(match.groups.number);
      if (value === null) {
        return null;
      }
      tokens.push({ type: "number", value });
    } else if (match.groups?.operator) {
      const value = parseOperatorToken(match.groups.operator);
      if (!value) {
        return null;
      }
      tokens.push({ type: "operator", value });
    } else {
      return null;
    }

    cursor = ARITHMETIC_TOKEN_PATTERN.lastIndex;
  }

  return expression.slice(cursor).trim() ? null : tokens;
}

function evaluateArithmeticTokens(tokens: ArithmeticToken[]): number | string | null {
  if (tokens.length < 3 || tokens.length % 2 === 0 || tokens[0]?.type !== "number") {
    return null;
  }

  const values: number[] = [tokens[0].value];
  const operators: ArithmeticOperator[] = [];

  for (let index = 1; index < tokens.length; index += 2) {
    const operatorToken = tokens[index];
    const numberToken = tokens[index + 1];
    if (operatorToken?.type !== "operator" || numberToken?.type !== "number") {
      return null;
    }

    if (operatorToken.value === "*" || operatorToken.value === "/") {
      if (operatorToken.value === "/" && numberToken.value === 0) {
        return "I can't divide by zero.";
      }

      const previous = values.pop();
      if (previous === undefined) {
        return null;
      }
      values.push(
        operatorToken.value === "*"
          ? previous * numberToken.value
          : previous / numberToken.value
      );
    } else {
      operators.push(operatorToken.value);
      values.push(numberToken.value);
    }
  }

  let result = values[0];
  for (let index = 0; index < operators.length; index += 1) {
    const nextValue = values[index + 1];
    if (nextValue === undefined) {
      return null;
    }
    result = operators[index] === "+" ? result + nextValue : result - nextValue;
  }

  return result;
}

function answerSimpleArithmetic(transcript: string): string | null {
  const tokens = tokenizeArithmeticExpression(normalizeArithmeticExpression(transcript));
  if (!tokens) {
    return null;
  }

  const result = evaluateArithmeticTokens(tokens);
  if (typeof result === "string") {
    return result;
  }

  return result === null ? null : `The answer is ${formatNumber(result)}.`;
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

  if (LIVE_LOOKUP_PATTERN.test(normalized) && !requiresBrowserAutomation(normalized)) {
    return {
      intent: "quick_answer",
      confidence: BASE_CONFIDENCE,
      query: normalized,
      needs_web_search: true,
    };
  }

  if (
    QUICK_QUESTION_PATTERN.test(normalized) &&
    !requiresBrowserAutomation(normalized) &&
    !requestsExternalRetrieval(normalized)
  ) {
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
