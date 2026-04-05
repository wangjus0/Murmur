import type { ServerEvent } from "@murmur/shared";
import { TtsAdapter } from "./tts.js";

interface Sendable {
  send(event: ServerEvent): void;
}

/**
 * Narrate a response.
 *
 * @param session    - WebSocket session to send events on.
 * @param displayText - Full text sent to the client for display in the response card.
 * @param apiKey     - ElevenLabs API key.
 * @param spokenText  - Optional concise summary for TTS. When omitted, `displayText`
 *                     is spoken verbatim (previous behaviour).
 */
export async function narrate(
  session: Sendable,
  displayText: string,
  apiKey: string,
  spokenText?: string
): Promise<void> {
  // Always send the full text so the response card shows complete information.
  session.send({ type: "narration_text", text: displayText });

  // Speak the summary when available; fall back to the full display text.
  const tts = new TtsAdapter(apiKey);
  await tts.synthesize(spokenText ?? displayText, (audio) => {
    session.send({ type: "narration_audio", audio });
  });
}
