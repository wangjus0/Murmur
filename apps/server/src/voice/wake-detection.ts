import { transcribePcm16Base64Chunks } from "./stt.js";

export type WakeDetectionResult = {
  detected: boolean;
  transcript: string;
};

export type WakeAudioTranscriber = (audioChunks: readonly string[]) => Promise<string>;

const WAKE_PHRASE_PATTERNS = [
  /\bhey\s+murmur\b/,
  /\bhi\s+murmur\b/,
  /\bokay\s+murmur\b/,
  /\bok\s+murmur\b/,
] as const;

export function normalizeWakeTranscript(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectWakePhrase(transcript: string): boolean {
  const normalized = normalizeWakeTranscript(transcript);
  return WAKE_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export async function detectWakePhraseFromAudio(
  audioChunks: readonly string[],
  options: {
    apiKey: string;
    transcribe?: WakeAudioTranscriber;
  }
): Promise<WakeDetectionResult> {
  const transcribe =
    options.transcribe ?? ((chunks: readonly string[]) => transcribePcm16Base64Chunks(options.apiKey, chunks));
  const transcript = await transcribe(audioChunks);

  return {
    detected: detectWakePhrase(transcript),
    transcript,
  };
}
