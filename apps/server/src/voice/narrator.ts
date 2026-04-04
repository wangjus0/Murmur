import type { ServerEvent } from "@diamond/shared";
import { TtsAdapter } from "./tts.js";

interface Sendable {
  send(event: ServerEvent): void;
}

export async function narrate(
  session: Sendable,
  text: string,
  apiKey: string
): Promise<void> {
  session.send({ type: "narration_text", text });

  const tts = new TtsAdapter(apiKey);
  await tts.synthesize(text, (audio) => {
    session.send({ type: "narration_audio", audio });
  });
}
