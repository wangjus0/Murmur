const BASE_URL = "https://api.browser-use.com/api/v3";
// Polling schedule: start fast (500 ms) and back off gradually to a cap (3 s).
// The first check fires after POLL_INITIAL_MS so fast integration tasks resolve
// quickly, while slow browser tasks don't hammer the API.
const POLL_INITIAL_MS = 500;
const POLL_MAX_MS = 3000;
const POLL_BACKOFF_FACTOR = 1.4; // each interval = prev * 1.4, capped at POLL_MAX_MS
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SKILL_IDS_PER_TASK = 3;
const WILDCARD_SKILL_IDS = ["*"] as const;
const PROFILE_SESSION_LIMIT_PATTERNS = [
  /free\s+plan\s+limit/i,
  /concurrent\s+sessions?\s+reached/i,
  /http\s*429/i,
];
const INTEGRATION_TOOL_IDS = new Set<string>([
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
]);

const TOOL_SKILL_TERMS: Record<string, readonly string[]> = {
  gmail: ["gmail", "google mail"],
  outlook: ["outlook", "microsoft outlook"],
  discord: ["discord"],
  slack: ["slack"],
  dropbox: ["dropbox"],
  google_drive: ["google drive"],
  google_sheets: ["google sheets"],
  supabase: ["supabase"],
  google_calendar: ["google calendar"],
  google_docs: ["google docs"],
  notion: ["notion"],
  exa: ["exa"],
  github: ["github"],
  jira: ["jira", "atlassian"],
  linear: ["linear"],
  figma: ["figma"],
  hubspot: ["hubspot"],
  salesforce: ["salesforce"],
  stripe: ["stripe"],
};

export interface BrowserTaskCallbacks {
  onStatus: (message: string) => void;
}

export interface BrowserTaskRunOptions {
  allowSubmit?: boolean;
  preferredToolId?: string | null;
  selectedToolReason?: string | null;
  forceIntegration?: boolean;
  strictIntegration?: boolean;
  integrationInstruction?: string | null;
  // Internal guard to avoid infinite strict-integration fallback recursion.
  integrationAutoRetry?: boolean;
}

export interface BrowserTaskExecutor {
  runSearch(
    query: string,
    callbacks: BrowserTaskCallbacks,
    options?: BrowserTaskRunOptions
  ): Promise<string>;
  runFormFillDraft(
    query: string,
    callbacks: BrowserTaskCallbacks,
    options?: BrowserTaskRunOptions
  ): Promise<string>;
  cancel(): Promise<void>;
}

interface BrowserAdapterOptions {
  profileId?: string | null;
}

export class BrowserAdapter implements BrowserTaskExecutor {
  private readonly apiKey: string;
  private readonly profileId: string | null;
  private currentTaskId: string | null = null;
  private currentSessionId: string | null = null;
  private cancelled = false;

  constructor(apiKey: string, options?: BrowserAdapterOptions) {
    this.apiKey = apiKey;
    this.profileId = normalizeProfileId(options?.profileId);
  }

  async runSearch(
    query: string,
    callbacks: BrowserTaskCallbacks,
    options?: BrowserTaskRunOptions
  ): Promise<string> {
    // Composio v3 path: when an integration instruction is available, send it
    // directly to the bu-max model — no need to wrap in a search task prompt.
    if (options?.forceIntegration && options.integrationInstruction) {
      return this.runTask(buildComposioTask(options.integrationInstruction), callbacks, options);
    }
    return this.runTask(
      buildSearchTaskPrompt(query, {
        preferredToolId: options?.preferredToolId,
        forceIntegration: options?.forceIntegration ?? false,
        integrationInstruction: options?.integrationInstruction,
      }),
      callbacks,
      options
    );
  }

  async runFormFillDraft(
    query: string,
    callbacks: BrowserTaskCallbacks,
    options?: BrowserTaskRunOptions
  ): Promise<string> {
    if (options?.forceIntegration && options.integrationInstruction) {
      return this.runTask(buildComposioTask(options.integrationInstruction), callbacks, options);
    }
    return this.runTask(
      buildFormFillDraftTaskPrompt(query, {
        allowSubmit: options?.allowSubmit ?? false,
        preferredToolId: options?.preferredToolId,
        forceIntegration: options?.forceIntegration ?? false,
        integrationInstruction: options?.integrationInstruction,
      }),
      callbacks,
      options
    );
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    const activeSessionId = this.currentSessionId;
    if (!activeSessionId) return;

    await this.stopSession(activeSessionId);
    this.currentSessionId = null;
  }

  async runTask(
    task: string,
    callbacks: BrowserTaskCallbacks,
    options?: BrowserTaskRunOptions
  ): Promise<string> {
    this.cancelled = false;
    callbacks.onStatus(
      options?.forceIntegration ? "Preparing integration task..." : "Creating browser task..."
    );

    // v3: session creation and task dispatch are a single POST
    const body: Record<string, unknown> = { task };
    if (this.profileId) {
      body.profile_id = this.profileId;
    }

    const createRes = await fetch(`${BASE_URL}/sessions`, {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!createRes.ok) {
      const detail = await readErrorDetails(createRes);
      throw new Error(`Browser Use v3 session create failed (${createRes.status}): ${detail}`);
    }

    const created = (await createRes.json()) as { id: string };
    if (!created.id) {
      throw new Error("Browser Use v3 session create response missing id");
    }

    this.currentSessionId = created.id;
    callbacks.onStatus(
      options?.forceIntegration
        ? "Integration task started, working..."
        : "Browser task started, working..."
    );

    // Poll until terminal status.
    // Sleep AFTER each check (not before) so a fast-completing task is
    // discovered on the first iteration. Interval starts at POLL_INITIAL_MS
    // and grows by POLL_BACKOFF_FACTOR each round up to POLL_MAX_MS.
    //
    // Status lifecycle per Browser Use API v3 docs:
    //   created → idle (sandbox ready, no task yet) → running → stopped
    //   or: running → timed_out / error
    // "idle" means the sandbox is WAITING for a task — NOT that the task finished.
    // Only "stopped" means the task completed (successfully or not).
    let lastStepCount = 0;
    let lastStepSummary = "";
    let pollInterval = POLL_INITIAL_MS;

    try {
      while (!this.cancelled) {
        const pollRes = await fetch(`${BASE_URL}/sessions/${this.currentSessionId}`, {
          headers: { "X-Browser-Use-API-Key": this.apiKey },
        });

        if (!pollRes.ok) {
          throw new Error(`Poll failed (${pollRes.status})`);
        }

        const sessionData = (await pollRes.json()) as {
          status: string;
          // output is anyOf: [{}, null] per the API schema — can be any JSON value
          output?: unknown;
          isTaskSuccessful?: boolean | null;
          stepCount?: number;
          lastStepSummary?: string | null;
        };

        console.log(`[Browser] Poll status=${sessionData.status} steps=${sessionData.stepCount ?? 0} isTaskSuccessful=${sessionData.isTaskSuccessful ?? "null"} outputType=${typeof sessionData.output} outputTruncated=${JSON.stringify(sessionData.output)?.slice(0, 200)}`);

        // Surface step progress when available
        const currentStepCount = sessionData.stepCount ?? 0;
        const currentSummary = sessionData.lastStepSummary ?? "";
        if (currentStepCount > lastStepCount || currentSummary !== lastStepSummary) {
          if (currentSummary && currentSummary !== lastStepSummary) {
            callbacks.onStatus(`Step ${currentStepCount}: ${currentSummary.slice(0, 120)}`);
          }
          lastStepCount = currentStepCount;
          lastStepSummary = currentSummary;
        }

        // "stopped" is the only terminal success status per the v3 API docs.
        // "idle" means the sandbox is healthy but waiting for a task — NOT done.
        if (sessionData.status === "stopped") {
          const output = extractOutput(sessionData.output);
          if (output) {
            return output;
          }
          // output is null/empty on stopped — fetch from the messages endpoint
          // which holds the agent's completion message.
          const messageOutput = await this.fetchCompletionMessage(this.currentSessionId);
          return messageOutput ?? "Task completed but no output was returned.";
        }

        if (
          sessionData.status === "error" ||
          sessionData.status === "timed_out"
        ) {
          const output = extractOutput(sessionData.output);
          // Attempt to get details from messages even on error/timeout
          if (!output) {
            const messageOutput = await this.fetchCompletionMessage(this.currentSessionId);
            if (messageOutput) return messageOutput;
          }
          return output ?? `Task ${sessionData.status}.`;
        }

        // Task still running (or sandbox in created/idle/running state) —
        // wait before polling again, then back off.
        await sleep(pollInterval);
        pollInterval = Math.min(Math.round(pollInterval * POLL_BACKOFF_FACTOR), POLL_MAX_MS);
      }

      return "Task was interrupted.";
    } finally {
      await this.stopSession(this.currentSessionId);
      this.currentSessionId = null;
    }
  }

  /**
   * Fetch the last completion/assistant message for a session.
   * Used as a fallback when the session's `output` field is null/empty
   * but the agent did produce a result in the message stream.
   */
  private async fetchCompletionMessage(sessionId: string | null): Promise<string | null> {
    if (!sessionId) return null;
    try {
      const res = await fetch(
        `${BASE_URL}/sessions/${sessionId}/messages?limit=20`,
        { headers: { "X-Browser-Use-API-Key": this.apiKey } }
      );
      if (!res.ok) return null;

      const data = (await res.json()) as {
        messages?: Array<{ role: string; type: string; data: string; hidden?: boolean }>;
      };

      if (!Array.isArray(data.messages) || data.messages.length === 0) return null;

      // Walk backwards — the last non-hidden AI message with type "completion"
      // or "assistant_message" is the agent's final answer.
      const reversed = [...data.messages].reverse();
      for (const msg of reversed) {
        if (msg.hidden) continue;
        if (msg.role !== "ai") continue;
        if (msg.type === "completion" || msg.type === "assistant_message") {
          const text = typeof msg.data === "string" ? msg.data.trim() : "";
          if (text) {
            console.log(`[Browser] Got output from messages (type=${msg.type}): ${text.slice(0, 200)}`);
            return text;
          }
        }
      }

      // Secondary fallback: any non-hidden AI message with non-empty data
      for (const msg of reversed) {
        if (msg.hidden) continue;
        if (msg.role !== "ai") continue;
        const text = typeof msg.data === "string" ? msg.data.trim() : "";
        if (text) {
          console.log(`[Browser] Got output from fallback message (type=${msg.type}): ${text.slice(0, 200)}`);
          return text;
        }
      }

      return null;
    } catch (err) {
      console.error("[Browser] fetchCompletionMessage error:", err);
      return null;
    }
  }

  // v3: stop a session via DELETE
  private async stopSession(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    try {
      await fetch(`${BASE_URL}/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { "X-Browser-Use-API-Key": this.apiKey },
      });
    } catch (err) {
      console.error("[Browser] Stop session error:", sessionId, err);
    }
  }

}

export { BrowserAdapter as BrowserUseAdapter };

/**
 * Safely extract a non-empty string from the Browser Use API `output` field.
 * The API types `output` as `anyOf: [{}, null]` — it can be a string, object,
 * array, number, or null. We normalise to a string or return null if empty.
 */
function extractOutput(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed || null;
  }
  // Non-string value (object, array, number, boolean) — JSON-serialise it so
  // Gemini's refineOutput step can still process the structured data.
  try {
    const serialised = JSON.stringify(raw, null, 2);
    return serialised || null;
  } catch {
    return null;
  }
}

function normalizeProfileId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!PROFILE_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeToolId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized;
}

function isIntegrationTool(toolId: string | null): boolean {
  return !!toolId && INTEGRATION_TOOL_IDS.has(toolId);
}

export function shouldFallbackFromProfileSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.trim()) {
    return false;
  }

  return PROFILE_SESSION_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

async function readErrorDetails(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text || "(empty response)";
  } catch {
    return "(failed to read response body)";
  }
}

interface BrowserUseSkillSummary {
  id: string;
  title: string;
  description: string;
  slug: string;
  goal: string;
  categories: string[];
}

function parseSkillListItems(items: unknown): BrowserUseSkillSummary[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const parsed: BrowserUseSkillSummary[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const raw = item as Record<string, unknown>;
    const id =
      typeof raw.id === "string"
        ? raw.id.trim()
        : typeof raw.skillId === "string"
          ? raw.skillId.trim()
          : typeof raw.skill_id === "string"
            ? raw.skill_id.trim()
            : "";
    if (!id) {
      continue;
    }

    const categoryValues: string[] = [];
    if (Array.isArray(raw.categories)) {
      categoryValues.push(
        ...raw.categories.filter((value): value is string => typeof value === "string")
      );
    }
    if (typeof raw.category === "string") {
      categoryValues.push(raw.category);
    }
    if (typeof raw.type === "string") {
      categoryValues.push(raw.type);
    }
    if (Array.isArray(raw.tags)) {
      categoryValues.push(...raw.tags.filter((value): value is string => typeof value === "string"));
    }

    parsed.push({
      id,
      title:
        typeof raw.title === "string"
          ? raw.title
          : typeof raw.name === "string"
            ? raw.name
            : "",
      description:
        typeof raw.description === "string"
          ? raw.description
          : typeof raw.summary === "string"
            ? raw.summary
            : "",
      slug:
        typeof raw.slug === "string"
          ? raw.slug
          : typeof raw.key === "string"
            ? raw.key
            : "",
      goal:
        typeof raw.goal === "string"
          ? raw.goal
          : typeof raw.objective === "string"
            ? raw.objective
            : "",
      categories: categoryValues,
    });
  }

  return parsed;
}

function extractSkillListItems(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const raw = payload as Record<string, unknown>;
  const directCandidates = [raw.items, raw.data, raw.results, raw.skills];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const nested = candidate as Record<string, unknown>;
    const nestedCandidates = [nested.items, nested.data, nested.results, nested.skills];
    for (const nestedCandidate of nestedCandidates) {
      if (Array.isArray(nestedCandidate)) {
        return nestedCandidate;
      }
    }
  }

  return [];
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getSkillTermsForTool(toolId: string): readonly string[] {
  const normalized = normalizeToolId(toolId);
  if (!normalized) {
    return [];
  }

  const explicit = TOOL_SKILL_TERMS[normalized];
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  return [normalized.replace(/_/g, " ")];
}

export function chooseSkillIdsForIntegration(
  rankedSkillIds: readonly string[],
  forceIntegration: boolean
): { skillIds: string[]; mode: "matched" | "wildcard" | "none" } {
  const ranked = rankedSkillIds
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_SKILL_IDS_PER_TASK);

  if (ranked.length > 0) {
    return { skillIds: ranked, mode: "matched" };
  }

  if (forceIntegration) {
    return { skillIds: [...WILDCARD_SKILL_IDS], mode: "wildcard" };
  }

  return { skillIds: [], mode: "none" };
}

function scoreSkillForTerms(
  skill: BrowserUseSkillSummary,
  normalizedToolId: string,
  terms: readonly string[]
): number {
  const title = normalizeSearchText(skill.title);
  const slug = normalizeSearchText(skill.slug);
  const description = normalizeSearchText(`${skill.description} ${skill.goal}`);
  const categoryText = normalizeSearchText(skill.categories.join(" "));
  let score = 0;
  let matchedTerm = false;

  for (const termRaw of terms) {
    const term = normalizeSearchText(termRaw);
    if (!term) {
      continue;
    }

    if (title.includes(term)) {
      score += 6;
      matchedTerm = true;
    }
    if (slug.includes(term)) {
      score += 5;
      matchedTerm = true;
    }
    if (description.includes(term)) {
      score += 3;
      matchedTerm = true;
    }
    if (categoryText.includes(term)) {
      score += 1;
      matchedTerm = true;
    }
  }

  if (!matchedTerm) {
    return 0;
  }

  const toolText = normalizedToolId.replace(/_/g, " ");
  if (title.includes(toolText)) {
    score += 4;
  }
  if (slug.includes(toolText)) {
    score += 3;
  }
  if (categoryText.includes("integration")) {
    score += 2;
  }

  return score;
}

export function rankSkillsForTool(
  skills: readonly BrowserUseSkillSummary[],
  toolId: string,
  terms: readonly string[]
): BrowserUseSkillSummary[] {
  const normalizedToolId = normalizeToolId(toolId);
  if (!normalizedToolId) {
    return [];
  }

  return skills
    .map((skill) => ({ skill, score: scoreSkillForTerms(skill, normalizedToolId, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.skill);
}

export function buildIntegrationSystemPromptExtension(toolId: string | null): string | null {
  const normalized = normalizeToolId(toolId);
  if (!normalized || !isIntegrationTool(normalized)) {
    return null;
  }

  const label = normalized.replace(/_/g, " ");
  return (
    `Prefer Browser Use integration skills for ${label}. ` +
    `If an OAuth-connected account is available, use it before manual website navigation.`
  );
}

function buildComposioTask(instruction: string): string {
  const cleaned = instruction.trim().replace(/\.+$/, "");
  return `${cleaned}.`;
}

export function buildSearchTaskPrompt(
  query: string,
  options?: {
    preferredToolId?: string | null;
    forceIntegration?: boolean;
    integrationInstruction?: string | null;
  }
): string {
  const preferredToolId = normalizeToolId(options?.preferredToolId);
  if (options?.forceIntegration && preferredToolId && isIntegrationTool(preferredToolId)) {
    return buildIntegrationSearchTaskPrompt(query, preferredToolId, {
      integrationInstruction: options?.integrationInstruction,
    });
  }
  if (options?.forceIntegration) {
    return buildAutoIntegrationSearchTaskPrompt(query, {
      integrationInstruction: options?.integrationInstruction,
    });
  }

  return (
    `Navigate to google.com, search for '${query}', and collect the top 5 result titles and URLs. ` +
    `Return results as a numbered list with title and URL for each.`
  );
}

export function buildIntegrationSearchTaskPrompt(
  query: string,
  toolId: string,
  options?: { integrationInstruction?: string | null }
): string {
  const directive = normalizeIntegrationInstruction(
    options?.integrationInstruction,
    toolId,
    query
  );
  return `${directive}.`;
}

export function buildFormFillDraftTaskPrompt(
  query: string,
  options?: {
    allowSubmit?: boolean;
    preferredToolId?: string | null;
    forceIntegration?: boolean;
    integrationInstruction?: string | null;
  }
): string {
  const preferredToolId = normalizeToolId(options?.preferredToolId);
  if (options?.forceIntegration && preferredToolId && isIntegrationTool(preferredToolId)) {
    return buildIntegrationFormFillDraftTaskPrompt(query, preferredToolId, {
      allowSubmit: options?.allowSubmit ?? false,
      integrationInstruction: options?.integrationInstruction,
    });
  }
  if (options?.forceIntegration) {
    return buildAutoIntegrationFormFillDraftTaskPrompt(query, {
      allowSubmit: options?.allowSubmit ?? false,
      integrationInstruction: options?.integrationInstruction,
    });
  }

  if (options?.allowSubmit) {
    return (
      `Based on this request: '${query}', navigate to the appropriate website. ` +
      `Find the relevant form and fill it out with reasonable values based on the request. ` +
      `If the user explicitly asked to submit, submit the form once after fields are completed. ` +
      `Never perform payment, checkout, or purchase actions. ` +
      `Report which fields were filled and whether submission occurred.`
    );
  }

  return (
    `Based on this request: '${query}', navigate to the appropriate website. ` +
    `Find the relevant form and fill it out with reasonable values based on the request. ` +
    `Do NOT submit the form. Do NOT click any submit, pay, checkout, or confirmation buttons. ` +
    `Report which fields were filled and with what values.`
  );
}

function buildAutoIntegrationSearchTaskPrompt(
  query: string,
  options?: { integrationInstruction?: string | null }
): string {
  const directive = normalizeAutoIntegrationInstruction(options?.integrationInstruction, query);
  return `${directive}.`;
}

export function buildIntegrationFormFillDraftTaskPrompt(
  query: string,
  toolId: string,
  options?: { allowSubmit?: boolean; integrationInstruction?: string | null }
): string {
  const directive = normalizeIntegrationInstruction(
    options?.integrationInstruction,
    toolId,
    query
  );
  if (options?.allowSubmit) {
    return `${directive}.`;
  }

  return `${directive}.`;
}

function buildAutoIntegrationFormFillDraftTaskPrompt(
  query: string,
  options?: { allowSubmit?: boolean; integrationInstruction?: string | null }
): string {
  const directive = normalizeAutoIntegrationInstruction(options?.integrationInstruction, query);
  if (options?.allowSubmit) {
    return `${directive}.`;
  }
  return `${directive}.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeIntegrationInstruction(
  rawInstruction: string | null | undefined,
  toolId: string,
  query: string
): string {
  const label = toolId.replace(/_/g, " ");
  const raw = (rawInstruction ?? "").trim().replace(/\s+/g, " ");
  if (raw.length > 0) {
    const extracted = raw
      .replace(
        /^(?:can\s+you\s+)?use\s+(?:the\s+)?[\w\s_-]+?\s+integration\b(?:\s*,?\s*(?:and(?:\s+then)?|to(?:\s+do)?|:))?[:\s-]*/i,
        ""
      )
      .trim()
      .replace(/[.!?]+$/, "");
    const objective = summarizeIntegrationObjective(extracted, 16, 220, toolId);

    if (objective) {
      return `Can you use the ${label} integration and ${objective}`;
    }
  }

  const objective = summarizeIntegrationObjective(query, 16, 180, toolId);
  return `Can you use the ${label} integration and ${objective}`;
}

function normalizeAutoIntegrationInstruction(
  rawInstruction: string | null | undefined,
  query: string
): string {
  const raw = (rawInstruction ?? "").trim().replace(/\s+/g, " ");
  if (raw.length > 0) {
    const extracted = raw
      .replace(
        /^(?:can\s+you\s+)?use\s+(?:the\s+)?[\w\s_-]+?\s+integration\b(?:\s*,?\s*(?:and(?:\s+then)?|to(?:\s+do)?|:))?[:\s-]*/i,
        ""
      )
      .trim()
      .replace(/[.!?]+$/, "");
    const objective = summarizeIntegrationObjective(extracted, 16, 220);
    if (objective) {
      return `Can you use the best available connected integration and ${objective}`;
    }
  }

  const objective = summarizeIntegrationObjective(query, 16, 180);
  return `Can you use the best available connected integration and ${objective}`;
}

function summarizeIntegrationObjective(
  text: string,
  maxWords: number,
  maxChars: number,
  toolId?: string
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
