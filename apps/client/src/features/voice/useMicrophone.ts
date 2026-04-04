import { useState, useRef, useCallback } from "react";
import { float32ToPcm16Base64 } from "../../lib/audio-utils";

interface UseMicrophoneOptions {
  onAudioChunk: (base64: string) => void;
  onStop: () => void;
}

export function useMicrophone({ onAudioChunk, onStop }: UseMicrophoneOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
      },
    });

    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const samples = e.inputBuffer.getChannelData(0);
      const base64 = float32ToPcm16Base64(samples);
      onAudioChunk(base64);
    };

    source.connect(processor);
    processor.connect(ctx.destination);

    ctxRef.current = ctx;
    streamRef.current = stream;
    processorRef.current = processor;
    setIsRecording(true);
  }, [onAudioChunk]);

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
