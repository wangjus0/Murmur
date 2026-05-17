import { useEffect, useRef } from "react";
import { AUDIO_SAMPLE_RATE } from "@murmur/shared";
import { float32ToPcm16Base64, resampleFloat32 } from "../../lib/audio-utils";
import { resolveServerHttpOrigin } from "../../lib/server-origin";

const START_LEVEL_THRESHOLD = 0.09;
const CONTINUE_LEVEL_THRESHOLD = 0.045;
const PRE_ROLL_CHUNK_LIMIT = 10;
const MIN_CAPTURE_MS = 650;
const MAX_CAPTURE_MS = 2600;
const SILENCE_AFTER_SPEECH_MS = 550;
const DETECTION_COOLDOWN_MS = 1200;

interface UseWakeActivationOptions {
  enabled: boolean;
  canListen: boolean;
  onWakeDetected: () => void | Promise<void>;
}

type WakeDetectionResponse = {
  result?: "wake_detected" | "no_match";
};

function calculateRms(samples: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0;
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / samples.length);
}

async function requestWakeDetection(audioChunks: readonly string[]): Promise<boolean> {
  const serverOrigin = resolveServerHttpOrigin(
    window.location,
    window.desktop?.getRealtimeWebSocketUrl?.()
  );
  const response = await fetch(`${serverOrigin}/api/wake-detect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ audioChunks }),
  });

  if (!response.ok) {
    throw new Error(`Wake detection failed (${response.status}).`);
  }

  const payload = (await response.json()) as WakeDetectionResponse;
  return payload.result === "wake_detected";
}

export function useWakeActivation({
  enabled,
  canListen,
  onWakeDetected,
}: UseWakeActivationOptions): void {
  const onWakeDetectedRef = useRef(onWakeDetected);

  useEffect(() => {
    onWakeDetectedRef.current = onWakeDetected;
  }, [onWakeDetected]);

  useEffect(() => {
    if (!enabled || !canListen) {
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let silentGain: GainNode | null = null;
    let isCapturing = false;
    let pendingDetection = false;
    let cooldownUntil = 0;
    let captureStartedAt = 0;
    let lastVoiceAt = 0;
    let preRollChunks: string[] = [];
    let captureChunks: string[] = [];

    const teardown = () => {
      processor?.disconnect();
      source?.disconnect();
      silentGain?.disconnect();
      void ctx?.close();
      stream?.getTracks().forEach((track) => track.stop());

      processor = null;
      source = null;
      silentGain = null;
      ctx = null;
      stream = null;
    };

    const submitCapture = (chunks: string[]) => {
      if (pendingDetection || chunks.length === 0) {
        return;
      }

      pendingDetection = true;
      void (async () => {
        try {
          const detected = await requestWakeDetection(chunks);
          if (!detected || cancelled) {
            return;
          }

          cancelled = true;
          teardown();
          await onWakeDetectedRef.current();
        } catch (error) {
          console.warn("[wake] Detection request failed:", error);
        } finally {
          pendingDetection = false;
          cooldownUntil = Date.now() + DETECTION_COOLDOWN_MS;
        }
      })();
    };

    const finishCapture = () => {
      if (!isCapturing) {
        return;
      }

      const chunks = captureChunks;
      isCapturing = false;
      captureStartedAt = 0;
      lastVoiceAt = 0;
      captureChunks = [];
      preRollChunks = [];
      submitCapture(chunks);
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (cancelled) {
          teardown();
          return;
        }

        ctx = new AudioContext();
        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        silentGain = ctx.createGain();
        silentGain.gain.value = 0;

        processor.onaudioprocess = (event) => {
          if (cancelled || pendingDetection) {
            return;
          }

          const now = Date.now();
          if (now < cooldownUntil) {
            return;
          }

          const samples = event.inputBuffer.getChannelData(0);
          const level = calculateRms(samples);
          const normalizedSamples =
            ctx && ctx.sampleRate !== AUDIO_SAMPLE_RATE
              ? resampleFloat32(samples, ctx.sampleRate, AUDIO_SAMPLE_RATE)
              : samples;
          const base64 = float32ToPcm16Base64(normalizedSamples);

          if (!isCapturing) {
            preRollChunks = [...preRollChunks, base64].slice(-PRE_ROLL_CHUNK_LIMIT);
            if (level < START_LEVEL_THRESHOLD) {
              return;
            }

            isCapturing = true;
            captureStartedAt = now;
            lastVoiceAt = now;
            captureChunks = [...preRollChunks];
            return;
          }

          captureChunks.push(base64);
          if (level >= CONTINUE_LEVEL_THRESHOLD) {
            lastVoiceAt = now;
          }

          const elapsedMs = now - captureStartedAt;
          const silentForMs = now - lastVoiceAt;
          if (
            elapsedMs >= MAX_CAPTURE_MS ||
            (elapsedMs >= MIN_CAPTURE_MS && silentForMs >= SILENCE_AFTER_SPEECH_MS)
          ) {
            finishCapture();
          }
        };

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);
        await ctx.resume();
      } catch (error) {
        console.warn("[wake] Unable to start demo voice activation:", error);
        teardown();
      }
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      return;
    }

    void start();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [canListen, enabled]);
}
