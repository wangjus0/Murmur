const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODELS = ["openrouter/free"] as const;
const DEFAULT_TIMEOUT_MS = 4500;

export interface AiClient {
  models: {
    generateContent: (params: {
      model: string;
      contents: string;
      config?: {
        responseMimeType?: string;
        timeoutMs?: number;
        maxTokens?: number;
      };
    }) => Promise<{ text: string }>;
  };
}

export interface AiClientOptions {
  models?: string | readonly string[];
  timeoutMs?: number;
}

export function createAiClient(apiKey: string, options: AiClientOptions = {}): AiClient {
  const models = normalizeModelList(options.models);
  const defaultTimeoutMs = normalizeTimeoutMs(options.timeoutMs);

  return {
    models: {
      generateContent: async ({ contents, config }) => {
        const isJson = config?.responseMimeType === "application/json";
        const timeoutMs = normalizeTimeoutMs(config?.timeoutMs ?? defaultTimeoutMs);
        let lastError: unknown = null;

        for (const model of models) {
          try {
            return await requestOpenRouter({
              apiKey,
              model,
              contents,
              config,
              timeoutMs,
              useResponseFormat: isJson,
            });
          } catch (err) {
            lastError = err;
            if (!isJson || !shouldRetryWithoutJsonResponseFormat(err)) {
              continue;
            }
          }

          try {
            return await requestOpenRouter({
              apiKey,
              model,
              contents,
              config,
              timeoutMs,
              useResponseFormat: false,
            });
          } catch (err) {
            lastError = err;
          }
        }

        throw lastError instanceof Error
          ? lastError
          : new Error("OpenRouter request failed.");
      },
    },
  };
}

async function requestOpenRouter(options: {
  apiKey: string;
  model: string;
  contents: string;
  config: Parameters<AiClient["models"]["generateContent"]>[0]["config"];
  timeoutMs: number;
  useResponseFormat: boolean;
}): Promise<{ text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: [{ role: "user", content: options.contents }],
    };
    if (options.useResponseFormat) {
      body.response_format = { type: "json_object" };
    }
    if (typeof options.config?.maxTokens === "number" && options.config.maxTokens > 0) {
      body.max_tokens = Math.floor(options.config.maxTokens);
    }

    const res = await fetch(OPENROUTER_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return { text: data.choices[0]?.message?.content ?? "" };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetryWithoutJsonResponseFormat(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const isRecoverableRequestError =
    /\bopenrouter\s+(400|422)\b/i.test(message) ||
    message.includes("bad request") ||
    message.includes("unprocessable");
  const mentionsStructuredOutput =
    message.includes("response_format") ||
    message.includes("json_object") ||
    message.includes("structured output") ||
    message.includes("json mode") ||
    message.includes("schema");
  const indicatesProviderRejection =
    message.includes("unsupported") ||
    message.includes("not support") ||
    message.includes("not supported") ||
    message.includes("does not support") ||
    message.includes("doesn't support") ||
    message.includes("invalid") ||
    message.includes("invalid request") ||
    message.includes("invalid parameter") ||
    message.includes("unrecognized") ||
    message.includes("unknown parameter") ||
    message.includes("not available") ||
    message.includes("not enabled") ||
    message.includes("not implemented");

  return isRecoverableRequestError || (mentionsStructuredOutput && indicatesProviderRejection);
}

function normalizeModelList(raw: AiClientOptions["models"]): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : DEFAULT_MODELS;

  const models = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return models.length > 0 ? models : [...DEFAULT_MODELS];
}

function normalizeTimeoutMs(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.max(250, Math.floor(raw));
}
