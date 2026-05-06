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
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const body: Record<string, unknown> = {
              model,
              messages: [{ role: "user", content: contents }],
            };
            if (isJson) {
              body.response_format = { type: "json_object" };
            }
            if (typeof config?.maxTokens === "number" && config.maxTokens > 0) {
              body.max_tokens = Math.floor(config.maxTokens);
            }

            const res = await fetch(OPENROUTER_BASE, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
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
          } catch (err) {
            lastError = err;
          } finally {
            clearTimeout(timeout);
          }
        }

        throw lastError instanceof Error
          ? lastError
          : new Error("OpenRouter request failed.");
      },
    },
  };
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
