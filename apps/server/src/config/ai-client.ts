const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "stepfun/step-3.5-flash:free";

export interface AiClient {
  models: {
    generateContent: (params: {
      model: string;
      contents: string;
      config?: { responseMimeType?: string };
    }) => Promise<{ text: string }>;
  };
}

export function createAiClient(apiKey: string): AiClient {
  return {
    models: {
      generateContent: async ({ contents, config }) => {
        const isJson = config?.responseMimeType === "application/json";

        const body: Record<string, unknown> = {
          model: MODEL,
          messages: [{ role: "user", content: contents }],
        };
        if (isJson) {
          body.response_format = { type: "json_object" };
        }

        const res = await fetch(OPENROUTER_BASE, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`OpenRouter ${res.status}: ${errorText}`);
        }

        const data = (await res.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        return { text: data.choices[0]?.message?.content ?? "" };
      },
    },
  };
}
