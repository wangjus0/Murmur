import type { ServerEvent } from "@murmur/shared";
import { TtsAdapter } from "./tts.js";

interface Sendable {
  send(event: ServerEvent): void;
}

interface TtsSynthesizer {
  synthesize(text: string, onAudioChunk: (base64Audio: string) => void): Promise<void>;
}

type TtsFactory = (apiKey: string) => TtsSynthesizer;

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
  spokenText?: string,
  createTts: TtsFactory = (ttsApiKey) => new TtsAdapter(ttsApiKey)
): Promise<void> {
  // Always send the full text so the response card shows complete information.
  session.send({ type: "narration_text", text: displayText });

  // Speak the summary when available; fall back to the full display text.
  try {
    const tts = createTts(apiKey);
    const ttsStartMs = Date.now();
    let loggedFirstAudioChunk = false;
    await tts.synthesize(spokenText ?? displayText, (audio) => {
      if (!loggedFirstAudioChunk) {
        loggedFirstAudioChunk = true;
        console.log(`[Latency] first_tts_audio_chunk_ms=${Date.now() - ttsStartMs}`);
      }
      session.send({ type: "narration_audio", audio });
    });
  } catch (err) {
    console.warn("[Narrator] TTS failed; delivered text response only.", err);
  }
}
