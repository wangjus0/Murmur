import { useState, useRef, useCallback } from "react";
import { float32ToPcm16Base64 } from "../../lib/audio-utils";

interface UseMicrophoneOptions {
  onAudioChunk: (base64: string) => void;
  onStop: () => void;
  onError?: (message: string) => void;
}

function getMicrophoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone access was blocked. Allow mic permissions in your browser and try again.";
    }

    if (error.name === "NotFoundError") {
      return "No microphone was found. Connect a mic and try again.";
    }

    if (error.name === "NotReadableError") {
      return "Your microphone is busy in another app. Close other apps using the mic and retry.";
    }

    if (error.name === "OverconstrainedError") {
      return "Microphone settings are unsupported on this device. Try another input device.";
    }
  }

  return "Unable to start microphone recording. Check browser permissions and try again.";
}

export function useMicrophone({
  onAudioChunk,
  onStop,
  onError,
}: UseMicrophoneOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const startRecording = useCallback(async (): Promise<boolean> => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onError?.(
        "Microphone is unavailable in this browser context. Use HTTPS or localhost to enable mic access."
      );
      return false;
    }

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      ctx = new AudioContext({ sampleRate: 16000 });
      const source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const samples = e.inputBuffer.getChannelData(0);
        const base64 = float32ToPcm16Base64(samples);
        onAudioChunk(base64);
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      await ctx.resume();

      ctxRef.current = ctx;
      streamRef.current = stream;
      processorRef.current = processor;
      setIsRecording(true);
      return true;
    } catch (error) {
      processor?.disconnect();
      await ctx?.close();
      stream?.getTracks().forEach((track) => track.stop());
      onError?.(getMicrophoneErrorMessage(error));
      return false;
    }
  }, [onAudioChunk, onError]);

  const stopRecording = useCallback(() => {
    processorRef.current?.disconnect();
    ctxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    processorRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    setIsRecording(false);
    onStop();
  }, [onStop]);

  return { startRecording, stopRecording, isRecording };
}
