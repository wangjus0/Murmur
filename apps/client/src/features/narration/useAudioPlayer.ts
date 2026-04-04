import { useState, useRef, useCallback } from "react";
import { base64ToBlob } from "../../lib/audio-utils";

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const queueRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const playNext = useCallback(() => {
    if (queueRef.current.length === 0) {
      setIsPlaying(false);
      return;
    }

    const base64 = queueRef.current.shift()!;
    const blob = base64ToBlob(base64, "audio/mpeg");
    const url = URL.createObjectURL(blob);

    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      playNext();
    };

    audio.play().catch((err) => {
      console.error("[AudioPlayer] Playback failed:", err);
      playNext();
    });
  }, []);

  const enqueue = useCallback(
    (base64Audio: string) => {
      queueRef.current.push(base64Audio);
      if (!isPlaying) {
        setIsPlaying(true);
        playNext();
      }
    },
    [isPlaying, playNext]
  );

  const stop = useCallback(() => {
    queueRef.current = [];
    audioRef.current?.pause();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  return { enqueue, stop, isPlaying };
}
