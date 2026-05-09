import { Router } from "express";
import { z } from "zod";
import {
  detectWakePhraseFromAudio,
  type WakeAudioTranscriber,
} from "../voice/wake-detection.js";

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_WAKE_CHUNKS = 96;
const MAX_WAKE_CHUNK_LENGTH = 256_000;

const wakeDetectionRequestSchema = z
  .object({
    audioChunks: z
      .array(
        z
          .string()
          .min(1)
          .max(MAX_WAKE_CHUNK_LENGTH)
          .regex(BASE64_PATTERN)
      )
      .min(1)
      .max(MAX_WAKE_CHUNKS),
  })
  .strict();

export function createWakeDetectionRouter(
  apiKey: string,
  options: {
    transcribe?: WakeAudioTranscriber;
  } = {}
): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const parsed = wakeDetectionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid wake detection payload." });
      return;
    }

    try {
      const result = await detectWakePhraseFromAudio(parsed.data.audioChunks, {
        apiKey,
        transcribe: options.transcribe,
      });

      res.json({
        result: result.detected ? "wake_detected" : "no_match",
      });
    } catch (error) {
      console.error("[wake] Detection failed:", error);
      res.status(502).json({ error: "Wake detection failed." });
    }
  });

  return router;
}
