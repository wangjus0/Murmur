import type { GoogleGenAI } from "@google/genai";
import type { ServerEvent } from "@diamond/shared";
import { classifyIntent } from "./intent.js";
import { narrate } from "../voice/narrator.js";

interface Orchestratable {
  send(event: ServerEvent): void;
  setState(state: "idle" | "listening" | "thinking" | "acting" | "speaking"): void;
}

export async function handleTranscriptFinal(
  session: Orchestratable,
  ai: GoogleGenAI,
  apiKey: string,
  text: string
): Promise<void> {
  try {
    session.setState("thinking");

    const result = await classifyIntent(ai, text);
    session.send({ type: "intent", intent: result });

    if (result.intent === "clarify") {
      session.setState("speaking");
      await narrate(
        session,
        result.clarification || "Could you clarify?",
        apiKey
      );
      session.setState("idle");
      session.send({ type: "done" });
      return;
    }

    // search or form_fill_draft
    session.setState("acting");
    // Browser execution is Set 8 -- not implemented yet
    session.setState("speaking");

    const action =
      result.intent === "search" ? "search for" : "fill a form about";
    await narrate(
      session,
      `I understood you want to ${action}: ${result.query}. Browser execution is not yet implemented.`,
      apiKey
    );

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
