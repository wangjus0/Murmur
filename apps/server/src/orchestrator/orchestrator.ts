import type { AiClient } from "../config/ai-client.js";
import type { IntentResult, ServerEvent } from "@murmur/shared";
import { env } from "../config/env.js";
import { tavilySearch } from "../tools/tavily/tavily-search.js";
import { BrowserAdapter } from "../tools/browser/adapter.js";
import { narrate } from "../voice/narrator.js";
import {
  createPolicyConfig,
  evaluateIntentPolicy,
  logPolicyBlock,
} from "../safety/policy.js";
import { classifyIntent } from "./intent.js";
import { generateToolPlan } from "./tool-guide.js";
import { runTool } from "../tools/core/tool-runner.js";
import { ToolPolicyBlockedError } from "../tools/core/tool-errors.js";
import "../tools/browser/web-extract.js";
import "../tools/browser/multi-site-compare.js";
import { z } from "zod";

interface Orchestratable {
  send(event: ServerEvent): void;
  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void;
  setBrowserAdapter(adapter: BrowserExecutor | null): void;
}

interface BrowserExecutor {
  runSearch(
    query: string,
    callbacks: { onStatus: (message: string) => void },
    options?: {
      preferredToolId?: ToolId;
      selectedToolReason?: string;
      forceIntegration?: boolean;
      strictIntegration?: boolean;
      integrationInstruction?: string;
    }
  ): Promise<string>;
  runFormFillDraft(
    query: string,
    callbacks: { onStatus: (message: string) => void },
    options?: {
      allowSubmit?: boolean;
      preferredToolId?: ToolId;
      selectedToolReason?: string;
      forceIntegration?: boolean;
      strictIntegration?: boolean;
      integrationInstruction?: string;
    }
  ): Promise<string>;
}

interface TranscriptFinalLegacyDependencies {
  classify?: (
    ai: AiClient,
    transcript: string
  ) => Promise<IntentResult>;
  classifyIntent?: (
    ai: AiClient,
    transcript: string
  ) => Promise<IntentResult>;
  narrate?: (
    session: Orchestratable,
    displayText: string,
    apiKey: string,
    spokenText?: string
  ) => Promise<void>;
  createBrowserAdapter?: (apiKey: string) => BrowserExecutor;
  selectTool?: (
    ai: AiClient,
    userRequest: string,
    intent: IntentResult["intent"]
  ) => Promise<ToolSelectionResult>;
  refineOutput?: (
    ai: AiClient,
    userRequest: string,
    rawOutput: string,
    historyContext?: string
  ) => Promise<RefinedOutput>;
  browserApiKey?: string;
  browserApiKeySource?: "user" | "server";
}

type TranscriptFinalOverrideDeps = Partial<TranscriptFinalDeps> &
  TranscriptFinalLegacyDependencies;

type TranscriptFinalDeps = Readonly<{
  classify: (ai: AiClient, text: string, historyContext?: string) => Promise<IntentResult>;
  narrate: (session: Orchestratable, displayText: string, apiKey: string, spokenText?: string) => Promise<void>;
  createBrowserAdapter: (apiKey: string) => BrowserExecutor;
  selectTool: (
    ai: AiClient,
    userRequest: string,
    intent: IntentResult["intent"]
  ) => Promise<ToolSelectionResult>;
  refineOutput: (
    ai: AiClient,
    userRequest: string,
    rawOutput: string,
    historyContext?: string
  ) => Promise<RefinedOutput>;
  refineBrowserQuery: (
    ai: AiClient,
    userRequest: string,
    intent: IntentResult["intent"],
    toolId: ToolId,
    historyContext?: string
  ) => Promise<string>;
  browserApiKey: string;
  browserApiKeySource: "user" | "server";
}>;

const defaultDeps: TranscriptFinalDeps = {
  classify: classifyIntent,
  narrate,
  createBrowserAdapter: (browserApiKey: string) => new BrowserAdapter(browserApiKey),
  selectTool: selectToolWithGemini,
  refineOutput: refineOutputWithGemini,
  refineBrowserQuery: refineBrowserQueryWithGemini,
  browserApiKey: env.BROWSER_USE_API_KEY,
  browserApiKeySource: "server",
};

const AVAILABLE_TOOL_IDS = [
  "browser_use",
  "web_extract",
  "multi_site_compare",
  "gmail",
  "outlook",
  "discord",
  "slack",
  "dropbox",
  "google_drive",
  "google_sheets",
  "supabase",
  "google_calendar",
  "google_docs",
  "notion",
  "exa",
  "github",
  "jira",
  "linear",
  "figma",
  "hubspot",
  "salesforce",
  "stripe",
] as const;

type ToolId = (typeof AVAILABLE_TOOL_IDS)[number];

type ToolSelectionResult = {
  toolId: ToolId;
  confidence: number;
  reason: string;
  integrationInstruction?: string;
};

const TOOL_SELECTION_SCHEMA = z.object({
  toolId: z.enum(AVAILABLE_TOOL_IDS),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(240),
  integrationInstruction: z.string().min(1).max(320).optional(),
});

const NATIVE_ORCHESTRATOR_TOOLS = new Set<ToolId>([
  "browser_use",
  "web_extract",
  "multi_site_compare",
]);
const INTEGRATION_TOOL_IDS = new Set<ToolId>(
  AVAILABLE_TOOL_IDS.filter((toolId) => !NATIVE_ORCHESTRATOR_TOOLS.has(toolId))
);

const TOOL_SELECTION_SYSTEM_PROMPT = `You are a tool router for a voice assistant with connected integrations.
Choose exactly one best tool for the user request from this list:
${AVAILABLE_TOOL_IDS.join(", ")}

## Implicit service mappings — apply these FIRST before considering browser_use
Even when the user does NOT name a brand, map these topics to the right integration:
- "email", "emails", "inbox", "unread", "check my email", "read my email" → gmail
- "calendar", "schedule", "events", "appointments", "upcoming meetings" → google_calendar
- "spreadsheet", "sheet" → google_sheets
- "document", "doc" (not a URL) → google_docs
- "my files", "my drive" → google_drive
- "notes", "notion page" → notion
- "repos", "pull requests", "issues" (code) → github
- "tickets", "jira" → jira
- "stripe payments", "invoices", "charges" → stripe
- "slack", "slack message" → slack
- "discord", "discord message" → discord

## Rules
- ALWAYS prefer an integration over browser_use when the task targets a connected service — even if the user does not name the brand.
- Use web_extract ONLY when the user provides a specific URL to read/summarize.
- Use multi_site_compare ONLY when comparing across multiple distinct websites.
- Use browser_use ONLY when no integration covers the task (e.g. general web search, navigating a random website).
- NEVER use browser_use for email, calendar, documents, spreadsheets, or messaging tasks — use the matching integration.
- If toolId is an integration tool, include integrationInstruction:
  "Can you use the <tool> integration and <short action-focused objective>"
- If toolId is not an integration tool, omit integrationInstruction.
- Return JSON only:
{"toolId":"...", "confidence":0.0, "reason":"short reason", "integrationInstruction":"Can you use the ... integration and ..."}`;

const PROVIDER_DETECTION_TERMS: Partial<Record<ToolId, readonly string[]>> = {
  gmail: [
    "gmail", "google mail",
    // Generic email terms — default to gmail when no brand is specified
    "my email", "my emails", "check email", "check my email", "read email", "read emails",
    "unread email", "unread emails", "unread messages", "inbox", "new emails",
    "email inbox", "recent emails", "latest emails", "compose email", "send email",
    "reply to email", "email thread",
  ],
  outlook: ["outlook", "microsoft outlook", "hotmail", "live.com"],
  discord: ["discord"],
  slack: ["slack", "slack message", "slack channel"],
  dropbox: ["dropbox"],
  google_drive: ["google drive", "my drive", "gdrive"],
  google_sheets: ["google sheets", "google spreadsheet", "spreadsheet"],
  supabase: ["supabase"],
  google_calendar: [
    "google calendar",
    // Generic calendar / scheduling terms
    "my calendar", "check calendar", "check my calendar", "calendar events",
    "my schedule", "check my schedule", "upcoming events", "what's on my calendar",
    "add to calendar", "create event", "schedule meeting", "schedule a meeting",
    "appointments", "my appointments",
  ],
  google_docs: ["google docs", "google document", "my docs"],
  notion: ["notion", "notion page", "notion database"],
  exa: ["exa"],
  github: [
    "github",
    "my repos", "my repository", "pull request", "pull requests", "open pr",
    "github issues", "github repo",
  ],
  jira: ["jira", "atlassian", "jira ticket", "jira issue"],
  linear: ["linear", "linear issue", "linear ticket"],
  figma: ["figma", "figma file", "figma design"],
  hubspot: ["hubspot", "hubspot contact", "hubspot deal"],
  salesforce: ["salesforce", "salesforce crm"],
  stripe: ["stripe", "stripe payment", "stripe invoice", "stripe customer"],
};

// ── Conversation history ──────────────────────────────────────────────────────

export type ConversationTurn = {
  transcript: string;
  response: string;
};

export type ConversationHistory = {
  /** Gemini-generated summary of older turns that were compacted away. */
  summary: string | null;
  /** Most recent verbatim turns kept in full. */
  recentTurns: ConversationTurn[];
};

export function createEmptyHistory(): ConversationHistory {
  return { summary: null, recentTurns: [] };
}

const MAX_RECENT_TURNS = 6;
const COMPACT_TO_TURNS = 3; // keep this many after compacting

function buildHistoryContext(history: ConversationHistory): string {
  const parts: string[] = [];
  if (history.summary) {
    parts.push(`Summary of earlier conversation: ${history.summary}`);
  }
  for (const turn of history.recentTurns) {
    parts.push(`User: ${turn.transcript}\nAssistant: ${turn.response}`);
  }
  return parts.join("\n\n");
}

async function maybeCompactHistory(
  ai: AiClient,
  history: ConversationHistory
): Promise<void> {
  if (history.recentTurns.length <= MAX_RECENT_TURNS) {
    return;
  }

  const toCompact = history.recentTurns.splice(0, history.recentTurns.length - COMPACT_TO_TURNS);
  const existingPrefix = history.summary ? `Previous summary: ${history.summary}\n\n` : "";
  const turnText = toCompact
    .map((t) => `User: ${t.transcript}\nAssistant: ${t.response}`)
    .join("\n\n");

  try {
    const generateContent = ai?.models?.generateContent;
    if (typeof generateContent === "function") {
      const response = await generateContent({
        model: "gemini-2.5-flash",
        contents:
          `Summarize this conversation into 2-3 concise sentences capturing key facts, topics, and results. ` +
          `The summary will be used as context for future turns.\n\n` +
          `${existingPrefix}${turnText}`,
      });
      history.summary = response.text?.trim() ?? history.summary;
    } else {
      // Fallback: plain text truncation
      history.summary = toCompact
        .map((t) => `${t.transcript} → ${t.response}`)
        .join("; ")
        .slice(0, 400);
    }
  } catch {
    history.summary = toCompact
      .map((t) => `${t.transcript} → ${t.response}`)
      .join("; ")
      .slice(0, 400);
  }
}

// ── Context-aware transcript resolution ──────────────────────────────────────

// Patterns that indicate the user's request may depend on prior context.
const UNDERSPECIFIED_PATTERNS = [
  /\b(it|that|this|those|these|they|them|there)\b/i,
  /\b(the same|more of|another|again|like that|like those)\b/i,
  /^(yes|no|okay|ok|sure|good|bad|nice|great|cool|perfect)\b/i,
  /^(tell me more|what about|and what|but what|so what|how about)\b/i,
  /^(show me|find me|get me|give me|look up|search for)\s+\w{1,3}\b/i,
  /\b(the (first|second|third|last|previous|next) one)\b/i,
];

function isTranscriptUnderspecified(transcript: string): boolean {
  const words = transcript.trim().split(/\s+/);
  if (words.length <= 4) return true; // very short — likely context-dependent
  return UNDERSPECIFIED_PATTERNS.some((p) => p.test(transcript.trim()));
}

const CONTEXT_RESOLUTION_SYSTEM_PROMPT = `You resolve ambiguous user requests using conversation history.
Rewrite the user's latest message as a fully self-contained query that makes sense on its own.

Rules:
- Replace pronouns (it, that, this, those) with the actual subject from history
- Resolve relative references ("more", "another one", "the first one") to be explicit
- If the request is about a topic discussed earlier, include that topic explicitly
- Preserve the user's intent — don't expand beyond what they asked
- If the request is already fully self-contained and specific, return it unchanged

Respond with JSON only:
{
  "resolved": "the fully self-contained version of the user's request"
}`;

async function resolveTranscriptWithContext(
  ai: AiClient,
  transcript: string,
  historyContext: string
): Promise<string> {
  const generateContent = ai?.models?.generateContent;
  if (typeof generateContent !== "function") return transcript;

  try {
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${CONTEXT_RESOLUTION_SYSTEM_PROMPT}\n\n` +
        `[Conversation History]\n${historyContext}\n\n` +
        `[User's latest message]\n"${transcript}"`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) return transcript;

    let parsed: { resolved?: unknown };
    try {
      parsed = JSON.parse(text) as { resolved?: unknown };
    } catch {
      return transcript;
    }

    if (typeof parsed.resolved === "string" && parsed.resolved.trim()) {
      return parsed.resolved.trim();
    }
    return transcript;
  } catch (err) {
    console.error("[Orchestrator] Context resolution failed:", err);
    return transcript;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const MAX_CORE_NARRATION_LINES = 12;
const MAX_CORE_NARRATION_CHARS = 900;
const PROCESS_LINE_PATTERNS = [
  /^step\s+\d+[:.-]?/i,
  /^status[:\s]/i,
  /^(creating|starting|running)\s+(browser|task|tool)\b/i,
  /^(browser\s+task|task)\s+(started|finished|failed|stopped)\b/i,
  /^(i|we)\s+(navigated|visited|went|opened|clicked|searched|reviewed|checked)\b/i,
  /^(navigated|visited|opened|clicked|searched)\b/i,
];
const OUTPUT_REFINEMENT_SYSTEM_PROMPT = `You clean raw browser automation output into a readable response.
Return ONLY the core information the user asked for.
Requirements for "answer":
- Exclude process narration (steps, navigation logs, tool status, "I clicked", etc.).
- Use markdown formatting when it improves readability:
  - Bullet points (-) for lists of items, results, or steps
  - **bold** for names, titles, or key values
  - Numbered lists when order matters
  - Plain prose for short single-fact answers
- If the user asked for N items (e.g. "3 most recent emails", "top 5 results"), preserve ALL N items. Do NOT reduce the count.
- If there is an error, state it plainly in one short sentence.

Requirements for "spoken_summary":
- A 1–2 sentence plain-English summary of the answer, suitable for reading aloud by a text-to-speech voice.
- No markdown, no bullet points, no bold/italic markers, no URLs.
- Cover only the most important finding or key takeaway. The user can read the full details on screen.
- Do not start with "Here is", "Sure", "Certainly", or filler phrases.
- If the answer is a list, name the top item or give a brief count (e.g. "I found 5 results — the top one is ...").
- If the answer is short (1–2 sentences of plain prose), the spoken_summary may be identical to the answer.

Respond with JSON only:
{
  "answer": "clean answer using markdown where helpful",
  "spoken_summary": "1-2 sentence voice-friendly summary"
}`;

const TAVILY_SYNTHESIS_SYSTEM_PROMPT = `You synthesize web search results into a concise, spoken-friendly answer.
The answer will be read aloud, so write in plain, natural language — no markdown, no bullet lists, no URLs.
Keep it under 3 sentences unless more detail is genuinely needed.
If the search results don't contain the answer, say so briefly.

Respond with JSON only:
{
  "answer": "the spoken answer"
}`;

async function synthesizeTavilyAnswer(
  ai: AiClient,
  userRequest: string,
  searchSummary: string,
  historyContext?: string
): Promise<string> {
  const generateContent = ai?.models?.generateContent;
  if (typeof generateContent !== "function") {
    // No Gemini available — return the raw Tavily summary directly.
    return searchSummary;
  }

  try {
    const contextSection = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${TAVILY_SYNTHESIS_SYSTEM_PROMPT}\n\n` +
        `${contextSection}` +
        `User asked: "${userRequest}"\n\n` +
        `Web search results:\n${searchSummary}`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) return searchSummary;

    let parsed: { answer?: unknown };
    try {
      parsed = JSON.parse(text) as { answer?: unknown };
    } catch {
      return searchSummary;
    }

    if (typeof parsed.answer === "string" && parsed.answer.trim()) {
      return parsed.answer.trim();
    }
    return searchSummary;
  } catch (err) {
    console.error("[Orchestrator] Tavily answer synthesis failed:", err);
    return searchSummary;
  }
}

const BROWSER_QUERY_REFINEMENT_SYSTEM_PROMPT = `You compress a user request into a short Browser Use task query.
Return JSON only:
{
  "query": "short action-oriented query",
  "objective": "very short objective phrase"
}

Rules:
- Keep it concise and actionable.
- Preserve critical nouns/numbers/time constraints.
- Do not include process narration.
- Avoid repeating the full user prompt verbatim.
- If toolId is an integration (gmail/notion/github/stripe/etc.), prefer objective phrasing that works in:
  "Can you use the <tool> integration and <objective>"`;

export function toCoreNarrationText(rawText: string): string {
  const normalized = normalizeNarrationText(rawText);
  if (!normalized) {
    return "Task completed.";
  }

  const lines = normalized.split("\n");
  const filteredLines = lines.filter((line) =>
    PROCESS_LINE_PATTERNS.every((pattern) => !pattern.test(line))
  );
  const selectedLines = (filteredLines.length > 0 ? filteredLines : lines).slice(
    0,
    MAX_CORE_NARRATION_LINES
  );

  const joined = selectedLines.join("\n");
  return truncateNarration(joined, MAX_CORE_NARRATION_CHARS);
}

function normalizeBrowserQueryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").trim();
}

function fallbackToolFromIntent(intent: IntentResult["intent"]): ToolSelectionResult {
  if (intent === "web_extract") {
    return { toolId: "web_extract", confidence: 0.7, reason: "intent indicates web extraction" };
  }

  if (intent === "multi_site_compare") {
    return {
      toolId: "multi_site_compare",
      confidence: 0.7,
      reason: "intent indicates cross-site comparison",
    };
  }

  return { toolId: "browser_use", confidence: 0.6, reason: "default browser execution path" };
}

function normalizeIntegrationInstruction(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

function stripIntegrationPrefix(text: string): string {
  return text
    .replace(
      /^(?:can\s+you\s+)?use\s+(?:the\s+)?[\w\s_-]+?\s+integration\b(?:\s*,?\s*(?:and(?:\s+then)?|to(?:\s+do)?|:))?[:\s-]*/i,
      ""
    )
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();
}

function hasExplicitCount(text: string): boolean {
  return /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(text);
}

function buildIntegrationInstructionForTool(
  toolId: ToolId,
  userQuery: string,
  rawInstruction?: string
): string | undefined {
  if (!INTEGRATION_TOOL_IDS.has(toolId)) {
    return undefined;
  }

  const label = toolId.replace(/_/g, " ");
  const normalizedRaw = normalizeIntegrationInstruction(rawInstruction);
  const rawObjective = stripIntegrationPrefix(normalizedRaw);
  const instructionObjective = summarizeIntegrationObjective(rawObjective || userQuery, 16, 220, toolId);
  const queryObjective = summarizeIntegrationObjective(userQuery, 16, 220, toolId);

  // Prefer the query-derived objective when it contains a specific count
  // that the (potentially Gemini-compressed) instruction lost.
  const objective =
    hasExplicitCount(queryObjective) && !hasExplicitCount(instructionObjective)
      ? queryObjective
      : instructionObjective;

  return `Can you use the ${label} integration and ${objective}`;
}

function summarizeIntegrationObjective(
  text: string,
  maxWords: number,
  maxChars: number,
  toolId?: ToolId
): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hi|hello|hey|yo)\b[,\s]*/i, "")
    .replace(/^(can you|could you|would you|please)\b[,\s]*/i, "")
    .replace(/\b(can you|could you|would you)\b/g, "")
    .replace(/\bplease\b/g, "")
    .replace(/\bfor me\b/g, "")
    .replace(/\bthanks?\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();

  if (toolId === "gmail") {
    const recentEmailsMatch = normalized.match(
      /\b(?:my\s+)?(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:most\s+recent|latest|recent|newest)\s+emails?\b/
    );
    if (recentEmailsMatch) {
      const count = recentEmailsMatch[1];
      if (count) {
        return `tell me what my ${count} most recent emails are`;
      }
      return "tell me what my most recent emails are";
    }
  }

  const words = normalized
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, maxWords);

  const compact = words.join(" ").slice(0, maxChars).trim();
  return compact || "complete the requested task";
}

function fallbackBrowserQuery(userRequest: string): string {
  const normalized = normalizeBrowserQueryText(userRequest);
  if (!normalized) {
    return "complete the requested task";
  }
  return normalized.slice(0, 200);
}

async function refineBrowserQueryWithGemini(
  ai: AiClient,
  userRequest: string,
  intent: IntentResult["intent"],
  toolId: ToolId,
  historyContext?: string
): Promise<string> {
  const fallback = fallbackBrowserQuery(userRequest);
  const generateContent = ai?.models?.generateContent;
  if (typeof generateContent !== "function") {
    return fallback;
  }

  try {
    const contextSection = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${BROWSER_QUERY_REFINEMENT_SYSTEM_PROMPT}\n\n` +
        `${contextSection}` +
        `Intent: ${intent}\n` +
        `Tool: ${toolId}\n` +
        `User request: ${userRequest}`,
      config: { responseMimeType: "application/json" },
    });
    const responseText = response.text;
    if (!responseText) {
      return fallback;
    }

    let parsed: { query?: unknown; objective?: unknown };
    try {
      parsed = JSON.parse(responseText) as { query?: unknown; objective?: unknown };
    } catch {
      return fallback;
    }

    const candidate =
      (typeof parsed.query === "string" && parsed.query) ||
      (typeof parsed.objective === "string" && parsed.objective) ||
      "";
    const normalized = normalizeBrowserQueryText(candidate).slice(0, 220);
    return normalized || fallback;
  } catch (err) {
    console.error("[Orchestrator] Browser query refinement failed:", err);
    return fallback;
  }
}

function detectExplicitIntegrationTool(userRequest: string): ToolId | null {
  const text = userRequest.toLowerCase();
  let bestMatch: { toolId: ToolId; score: number } | null = null;

  for (const toolId of INTEGRATION_TOOL_IDS) {
    const defaultTerm = toolId.replace(/_/g, " ");
    const terms = PROVIDER_DETECTION_TERMS[toolId] ?? [defaultTerm];

    for (const rawTerm of terms) {
      const term = rawTerm.trim().toLowerCase();
      if (!term || !new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(text)) {
        continue;
      }

      const score = term.length;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { toolId, score };
      }
    }
  }

  return bestMatch?.toolId ?? null;
}

function tryParseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseToolSelectionResponse(rawText: string): unknown {
  const direct = tryParseJsonObject(rawText);
  if (direct) {
    return direct;
  }

  const firstJsonObject = extractFirstJsonObject(rawText);
  if (!firstJsonObject) {
    return null;
  }

  return tryParseJsonObject(firstJsonObject);
}

function buildFallbackSelection(
  intent: IntentResult["intent"],
  userRequest: string
): ToolSelectionResult {
  const explicitIntegrationTool = detectExplicitIntegrationTool(userRequest);
  if (explicitIntegrationTool) {
    return {
      toolId: explicitIntegrationTool,
      confidence: 0.8,
      reason: `explicit provider mapping to ${explicitIntegrationTool}`,
      integrationInstruction: buildIntegrationInstructionForTool(
        explicitIntegrationTool,
        userRequest
      ),
    };
  }

  const fallback = fallbackToolFromIntent(intent);
  return {
    ...fallback,
    integrationInstruction: buildIntegrationInstructionForTool(fallback.toolId, userRequest),
  };
}

export async function selectToolWithGemini(
  ai: AiClient,
  userRequest: string,
  intent: IntentResult["intent"]
): Promise<ToolSelectionResult> {
  const fallback = buildFallbackSelection(intent, userRequest);
  const generateContent = ai?.models?.generateContent;
  if (typeof generateContent !== "function") {
    return fallback;
  }

  try {
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${TOOL_SELECTION_SYSTEM_PROMPT}\n\n` +
        `Detected intent: ${intent}\n` +
        `User request: ${userRequest}`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) {
      return fallback;
    }

    const parsed = parseToolSelectionResponse(text);
    if (!parsed) {
      return fallback;
    }

    const selectedResult = TOOL_SELECTION_SCHEMA.safeParse(parsed);
    if (!selectedResult.success) {
      return fallback;
    }
    const selected = selectedResult.data;
    const explicitIntegrationTool = detectExplicitIntegrationTool(userRequest);
    const finalToolId =
      explicitIntegrationTool && selected.toolId !== explicitIntegrationTool
        ? explicitIntegrationTool
        : selected.toolId;
    const finalReason =
      explicitIntegrationTool && selected.toolId !== explicitIntegrationTool
        ? `explicit provider mapping to ${explicitIntegrationTool}; ${selected.reason}`.slice(0, 240)
        : selected.reason;

    const integrationInstruction = buildIntegrationInstructionForTool(
      finalToolId,
      userRequest,
      selected.integrationInstruction
    );
    return {
      toolId: finalToolId,
      confidence: selected.confidence,
      reason: finalReason,
      integrationInstruction,
    };
  } catch (err) {
    console.error("[Orchestrator] Tool selection failed:", err);
    return fallback;
  }
}

function resolveExecutionIntent(
  selectedToolId: ToolId,
  classifiedIntent: IntentResult["intent"]
): IntentResult["intent"] {
  if (selectedToolId === "web_extract") {
    return "web_extract";
  }
  if (selectedToolId === "multi_site_compare") {
    return "multi_site_compare";
  }

  // If we chose an integration tool, force browser adapter paths instead of native extract/compare prompts.
  if (INTEGRATION_TOOL_IDS.has(selectedToolId)) {
    return classifiedIntent === "form_fill_draft" ? "form_fill_draft" : "search";
  }

  return classifiedIntent;
}

export interface RefinedOutput {
  /** Full markdown-formatted answer shown in the response card. */
  displayText: string;
  /** Short plain-English summary for TTS playback (may equal displayText for short answers). */
  spokenSummary: string;
}

export async function refineOutputWithGemini(
  ai: AiClient,
  userRequest: string,
  rawOutput: string,
  historyContext?: string
): Promise<RefinedOutput> {
  const fallbackText = toCoreNarrationText(rawOutput);
  const fallback: RefinedOutput = { displayText: fallbackText, spokenSummary: fallbackText };
  const generateContent = ai?.models?.generateContent;

  if (typeof generateContent !== "function") {
    return fallback;
  }

  try {
    const contextSection = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${OUTPUT_REFINEMENT_SYSTEM_PROMPT}\n\n` +
        `${contextSection}` +
        `User request:\n${userRequest}\n\n` +
        `Raw browser/tool output:\n${rawOutput}`,
      config: { responseMimeType: "application/json" },
    });

    const responseText = response.text;
    if (!responseText) {
      return fallback;
    }

    let parsed: { answer?: unknown; spoken_summary?: unknown };
    try {
      parsed = JSON.parse(responseText) as { answer?: unknown; spoken_summary?: unknown };
    } catch {
      return fallback;
    }

    if (typeof parsed.answer !== "string") {
      return fallback;
    }

    const displayText = normalizeNarrationText(parsed.answer);
    if (!displayText) {
      return fallback;
    }

    const spokenSummary =
      typeof parsed.spoken_summary === "string" && parsed.spoken_summary.trim()
        ? parsed.spoken_summary.trim()
        : normalizeNarrationText(parsed.answer);

    return { displayText, spokenSummary };
  } catch (err) {
    console.error("[Orchestrator] Output refinement failed:", err);
    return fallback;
  }
}

function normalizeNarrationText(text: string): string {
  const strippedMarkdown = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)");

  return strippedMarkdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function truncateNarration(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const clipped = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? ")
  );
  if (sentenceEnd >= Math.floor(maxChars * 0.55)) {
    return clipped.slice(0, sentenceEnd + 1).trim();
  }

  return `${clipped.trimEnd()}...`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Responses shorter than this threshold are already concise enough to speak as-is.
const SUMMARY_THRESHOLD_CHARS = 280;

const VOICE_SUMMARY_SYSTEM_PROMPT = `You summarize a detailed text response into a short spoken voice summary.
The summary will be read aloud by a text-to-speech voice, so:
- Write in plain, natural spoken English — no markdown, no bullet points, no numbered lists, no bold/italic markers.
- Cover only the most important single finding or key takeaway. The user can read the full details on screen.
- Keep it to 1–2 sentences maximum.
- Do not start with "Here is", "Sure", "Certainly", or filler phrases.
- If the response is a list of items, name the top item or give a brief count summary (e.g. "I found 5 results — the top one is ...").
- If the response is an error or blocked action, state it as-is in one sentence.

Respond with JSON only:
{
  "summary": "the spoken summary"
}`;

/**
 * Generate a short, voice-friendly spoken summary of a potentially long display text.
 * Returns the summary string on success, or a normalised plain-text fallback on failure.
 */
async function summarizeForSpeech(
  ai: AiClient,
  displayText: string
): Promise<string> {
  // Short responses are already concise — skip the extra Gemini round-trip.
  if (displayText.length <= SUMMARY_THRESHOLD_CHARS) {
    return normalizeNarrationText(displayText);
  }

  const generateContent = ai?.models?.generateContent;
  if (typeof generateContent !== "function") {
    return normalizeNarrationText(displayText);
  }

  try {
    const response = await generateContent({
      model: "gemini-2.5-flash",
      contents: `${VOICE_SUMMARY_SYSTEM_PROMPT}\n\nFull response to summarise:\n${displayText}`,
      config: { responseMimeType: "application/json" },
    });

    const responseText = response.text;
    if (!responseText) return normalizeNarrationText(displayText);

    let parsed: { summary?: unknown };
    try {
      parsed = JSON.parse(responseText) as { summary?: unknown };
    } catch {
      return normalizeNarrationText(displayText);
    }

    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      return parsed.summary.trim();
    }
    return normalizeNarrationText(displayText);
  } catch (err) {
    console.error("[Orchestrator] Voice summary generation failed:", err);
    return normalizeNarrationText(displayText);
  }
}

// Maps integration names returned by the tool-guide (e.g. "Gmail", "Google Drive")
// to the tool IDs used by the browser adapter and AVAILABLE_TOOL_IDS.
const INTEGRATION_NAME_TO_TOOL_ID: Record<string, ToolId> = {
  gmail: "gmail",
  "google mail": "gmail",
  outlook: "outlook",
  "microsoft outlook": "outlook",
  discord: "discord",
  slack: "slack",
  dropbox: "dropbox",
  "google drive": "google_drive",
  "google_drive": "google_drive",
  "google sheets": "google_sheets",
  "google_sheets": "google_sheets",
  supabase: "supabase",
  "google calendar": "google_calendar",
  "google_calendar": "google_calendar",
  "google docs": "google_docs",
  "google_docs": "google_docs",
  notion: "notion",
  exa: "exa",
  github: "github",
  jira: "jira",
  atlassian: "jira",
  linear: "linear",
  figma: "figma",
  hubspot: "hubspot",
  salesforce: "salesforce",
  stripe: "stripe",
};

function mapToolPlanIntegrationToToolId(name: string): ToolId | null {
  const lower = name.toLowerCase().trim();
  return INTEGRATION_NAME_TO_TOOL_ID[lower] ?? null;
}

function resolveDeps(maybeDeps: TranscriptFinalOverrideDeps | undefined): TranscriptFinalDeps {
  return {
    classify: maybeDeps?.classify ?? maybeDeps?.classifyIntent ?? defaultDeps.classify,
    narrate: maybeDeps?.narrate ?? defaultDeps.narrate,
    createBrowserAdapter:
      maybeDeps?.createBrowserAdapter ?? defaultDeps.createBrowserAdapter,
    selectTool: maybeDeps?.selectTool ?? defaultDeps.selectTool,
    refineOutput: maybeDeps?.refineOutput ?? defaultDeps.refineOutput,
    refineBrowserQuery: maybeDeps?.refineBrowserQuery ?? defaultDeps.refineBrowserQuery,
    browserApiKey: maybeDeps?.browserApiKey ?? defaultDeps.browserApiKey,
    browserApiKeySource:
      maybeDeps?.browserApiKeySource ?? defaultDeps.browserApiKeySource,
  };
}

export async function handleTranscriptFinal(
  session: Orchestratable,
  ai: AiClient,
  apiKey: string,
  text: string,
  history?: ConversationHistory,
  allowlistOrDeps?:
    | string
    | TranscriptFinalOverrideDeps,
  maybeDeps?: TranscriptFinalOverrideDeps
): Promise<void> {
  const navigationAllowlist =
    typeof allowlistOrDeps === "string" ? allowlistOrDeps : env.NAVIGATION_ALLOWLIST;
  const deps = resolveDeps(
    typeof allowlistOrDeps === "string" ? maybeDeps : allowlistOrDeps
  );

  const historyContext = history ? buildHistoryContext(history) : "";

  try {
    session.setState("thinking");

    // Resolve underspecified/context-dependent requests using session history.
    // e.g. "show me more", "what about that one", "it" → fully specified query.
    let resolvedText = text;
    if (historyContext && isTranscriptUnderspecified(text)) {
      const expanded = await resolveTranscriptWithContext(ai, text, historyContext);
      if (expanded !== text) {
        resolvedText = expanded;
        console.log(`[Orchestrator] Context-resolved: "${text}" → "${resolvedText}"`);
        session.send({ type: "action_status", message: `Context: ${resolvedText}` });
      }
    }

    const classified = await deps.classify(ai, resolvedText, historyContext || undefined);

    // When the model genuinely can't determine intent, ask the user for clarification
    // rather than guessing. The session stays alive; the next text_input resumes the turn.
    if (classified.intent === "clarify") {
      const question =
        classified.clarification ||
        "Could you give me a bit more detail about what you'd like me to do?";
      session.send({ type: "clarification_request", question });
      session.setState("idle");
      // Record in history so the follow-up response has full context.
      // Compaction runs in the background — it must not block the session
      // staying open for the user's clarification reply.
      if (history) {
        history.recentTurns.push({
          transcript: text,
          response: `Asked for clarification: ${question}`,
        });
        maybeCompactHistory(ai, history).catch((err) =>
          console.error("[Orchestrator] Background compaction error (clarify):", err)
        );
      }
      return; // Do NOT send "done" — session remains open for the user's reply
    }

    const result: IntentResult = classified;
    session.send({ type: "intent", intent: result });

    if (result.intent === "quick_answer") {
      let answer: string;

      if (result.needs_web_search && env.TAVILY_API_KEY) {
        // Fast web search path: use Tavily to get live data, then let Gemini
        // synthesize a clean spoken answer from the results.
        session.send({ type: "action_status", message: "Searching the web..." });
        const tavilyResult = await tavilySearch(
          resolvedText,
          env.TAVILY_API_KEY,
          (msg) => session.send({ type: "action_status", message: msg })
        );

        if (tavilyResult && tavilyResult.summary) {
          answer = await synthesizeTavilyAnswer(
            ai,
            resolvedText,
            tavilyResult.summary,
            historyContext || undefined
          );
        } else {
          // Tavily failed or returned nothing — fall back to Gemini-only answer.
          answer = result.answer || "I wasn't able to find a current answer to that.";
        }
      } else {
        // Pure Gemini knowledge answer (no web search needed).
        answer = result.answer || "I'm not sure how to answer that.";
      }

      session.setState("speaking");
      // quick_answer responses come from Gemini/Tavily already written for voice,
      // so they are usually already concise. Still run through summarizeForSpeech
      // to catch any cases where the answer grew long.
      const spokenAnswer = await summarizeForSpeech(ai, answer);
      await deps.narrate(session, answer, apiKey, spokenAnswer);
      // Push history and compact in the background — don't block the done event.
      if (history) {
        history.recentTurns.push({ transcript: text, response: answer });
        maybeCompactHistory(ai, history).catch((err) =>
          console.error("[Orchestrator] Background compaction error (quick_answer):", err)
        );
      }
      session.setState("idle");
      session.send({ type: "done" });
      return;
    }

    const policyDecision = evaluateIntentPolicy(
      result,
      createPolicyConfig(navigationAllowlist, env.ALLOW_FINAL_FORM_SUBMISSION)
    );
    if (!policyDecision.allowed) {
      logPolicyBlock({
        reason: policyDecision.reason,
        intent: result.intent,
        query: result.query,
      });

      session.send({ type: "action_status", message: policyDecision.message });
      session.setState("speaking");
      await deps.narrate(session, policyDecision.message, apiKey);
      session.setState("idle");
      session.send({ type: "done" });
      return;
    }

    // web_extract and multi_site_compare route directly to runTool() and don't
    // need integration routing — skip the generateToolPlan Gemini call for them.
    const needsToolPlan = result.intent !== "web_extract" && result.intent !== "multi_site_compare";
    const toolPlan = needsToolPlan
      ? await generateToolPlan(ai, resolvedText, result.intent, historyContext || undefined)
      : null;

    if (toolPlan) {
      console.log(`[ToolGuide] Strategy: ${toolPlan.strategy}, integrations: [${toolPlan.integrations.join(", ")}]`);
      session.send({
        type: "action_status",
        message: toolPlan.integrations.length
          ? `Using ${toolPlan.integrations.join(", ")} → ${toolPlan.reasoning}`
          : toolPlan.reasoning,
      });
    }

    session.setState("acting");

    const statusCb = {
      onStatus: (msg: string) => session.send({ type: "action_status", message: msg }),
    };

    // Use enhanced prompt from tool guide when available; fall back to context-resolved text.
    const taskQuery = toolPlan?.enhanced_prompt || resolvedText;

    let output: string;
    const browser = deps.createBrowserAdapter(deps.browserApiKey);
    session.setBrowserAdapter(browser);

    if (result.intent === "web_extract" || result.intent === "multi_site_compare") {
      try {
        const toolResult = await runTool(
          result.intent,
          {
            query: taskQuery,
            browserApiKey: deps.browserApiKey,
            onStatus: statusCb.onStatus,
          },
          createPolicyConfig(navigationAllowlist, env.ALLOW_FINAL_FORM_SUBMISSION)
        );
        output = toolResult.output;
      } catch (err) {
        if (err instanceof ToolPolicyBlockedError) {
          logPolicyBlock({ reason: "dangerous_action", intent: result.intent, query: result.query });
          session.send({ type: "action_status", message: err.userMessage });
          session.setState("speaking");
          await deps.narrate(session, err.userMessage, apiKey);
          session.setState("idle");
          session.send({ type: "done" });
          return;
        }
        console.error("[Orchestrator] Tool error:", err);
        output = "Tool task failed. " + (err instanceof Error ? err.message : "");
      }
    } else {
      try {
        // Resolve integration options from the tool guide's plan.
        // When Gemini identified a specific integration (Gmail, Slack, etc.),
        // pass it through to the browser adapter so BrowserUse uses that
        // connected integration instead of generic web navigation.
        let integrationOptions: {
          forceIntegration?: boolean;
          preferredToolId?: ToolId;
          integrationInstruction?: string;
        } = {};

        if (toolPlan && toolPlan.strategy !== "browser_only" && toolPlan.integrations.length > 0) {
          const primaryIntegration = toolPlan.integrations[0];
          const mappedToolId = mapToolPlanIntegrationToToolId(primaryIntegration);
          if (mappedToolId && INTEGRATION_TOOL_IDS.has(mappedToolId)) {
            const instruction = buildIntegrationInstructionForTool(mappedToolId, resolvedText);
            integrationOptions = {
              forceIntegration: true,
              preferredToolId: mappedToolId,
              integrationInstruction: instruction,
            };
            console.log(`[Orchestrator] Routing to integration: ${mappedToolId} (from tool plan: "${primaryIntegration}")`);
          }
        }

        // Hard fallback: if Gemini returned browser_only but the user's request
        // clearly targets a connected integration (e.g. "check my email"), override it.
        if (!integrationOptions.preferredToolId) {
          const detectedTool = detectExplicitIntegrationTool(resolvedText);
          if (detectedTool) {
            const instruction = buildIntegrationInstructionForTool(detectedTool, resolvedText);
            integrationOptions = {
              forceIntegration: true,
              preferredToolId: detectedTool,
              integrationInstruction: instruction,
            };
            console.log(`[Orchestrator] Hard-override to integration: ${detectedTool} (keyword match on "${resolvedText}")`);
          }
        }

        if (result.intent === "search") {
          output = await browser.runSearch(taskQuery, statusCb, integrationOptions);
        } else {
          output = await browser.runFormFillDraft(taskQuery, statusCb, {
            allowSubmit: env.ALLOW_FINAL_FORM_SUBMISSION,
            ...integrationOptions,
          });
        }
      } catch (err) {
        console.error("[Orchestrator] Browser error:", err);
        output = "Browser task failed. " + (err instanceof Error ? err.message : "");
      }
    }

    session.setBrowserAdapter(null);
    session.setState("speaking");
    // refineOutputWithGemini now produces both the display text and a spoken
    // summary in a single Gemini call, saving a sequential round-trip.
    const { displayText: refinedOutput, spokenSummary } = await deps.refineOutput(
      ai, resolvedText, output, historyContext || undefined
    );
    await deps.narrate(session, refinedOutput, apiKey, spokenSummary);

    // Push history and compact in the background — don't block the done event.
    if (history) {
      history.recentTurns.push({ transcript: text, response: refinedOutput });
      maybeCompactHistory(ai, history).catch((err) =>
        console.error("[Orchestrator] Background compaction error (browser):", err)
      );
    }

    session.setState("idle");
    session.send({ type: "done" });
  } catch (err) {
    console.error("[Orchestrator] Error:", err);
    session.send({
      type: "error",
      message: err instanceof Error ? err.message : "Unknown orchestrator error",
    });
    session.setState("idle");
  }
}
