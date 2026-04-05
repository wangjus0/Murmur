import { WebSocket, type RawData } from "ws";
import { STT_MODEL_ID, AUDIO_FORMAT, AUDIO_SAMPLE_RATE } from "@murmur/shared";

interface SttCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
}

export class SttAdapter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private callbacks: SttCallbacks;
  private closingByClient = false;
  private pendingChunks: string[] = [];
  /** Raw PCM16 bytes, buffered so we can fall back to batch STT if VAD never commits. */
  private audioBuffer: Buffer[] = [];
  /** Set to true the first time ElevenLabs emits a committed_transcript during streaming. */
  private hasReceivedCommit = false;

  constructor(apiKey: string, callbacks: SttCallbacks) {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
      url.searchParams.set("model_id", STT_MODEL_ID);
      url.searchParams.set("audio_format", AUDIO_FORMAT);
      url.searchParams.set("commit_strategy", "vad");
      url.searchParams.set("language_code", "en");

      this.ws = new WebSocket(url.toString(), {
        headers: { "xi-api-key": this.apiKey },
      });
      this.closingByClient = false;

      this.ws.on("open", () => {
        console.log(`[STT] Connected to ElevenLabs (${this.pendingChunks.length} buffered chunks)`);
        // Flush any audio chunks that arrived before the connection opened
        for (const chunk of this.pendingChunks) {
          this.ws!.send(chunk);
        }
        this.pendingChunks = [];
        resolve();
      });

      this.ws.on("message", (data: RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type?: string;
            message_type?: string;
            text?: string;
            reason?: string;
            error?: string;
            message?: string;
          };
          const eventType = msg.message_type ?? msg.type;

          if (eventType === "partial_transcript" && msg.text?.trim()) {
            this.callbacks.onPartial(msg.text);
            return;
          }

          if (
            (eventType === "final_transcript" ||
              eventType === "committed_transcript" ||
              eventType === "committed_transcript_with_timestamps") &&
            msg.text?.trim()
          ) {
            this.hasReceivedCommit = true;
            this.callbacks.onFinal(msg.text);
            return;
          }

          if (
            eventType?.includes("error") ||
            eventType === "input_error" ||
            eventType === "auth_error" ||
            eventType === "rate_limited"
          ) {
            const errorMessage =
              msg.reason ||
              msg.error ||
              msg.message ||
              "Speech recognition request was rejected.";
            this.callbacks.onError(errorMessage);
          }
        } catch (err) {
          console.error("[STT] Failed to parse message:", err);
        }
      });

      this.ws.on("error", (err: Error) => {
        console.error("[STT] WebSocket error:", err.message);
        this.callbacks.onError(err.message);
        reject(err);
      });

      this.ws.on("close", (code, reasonBuffer) => {
        const reasonText = reasonBuffer.toString() || "no reason provided";
        console.log(`[STT] Connection closed (code=${code}, reason=${reasonText})`);

        if (!this.closingByClient && code !== 1000 && code !== 1001) {
          this.callbacks.onError(`Speech recognition disconnected (${code}: ${reasonText}).`);
        }

        this.ws = null;
      });
    });
  }

  sendAudio(base64Chunk: string): void {
    if (!base64Chunk.length) return;

    // Buffer raw PCM16 bytes for batch fallback
    this.audioBuffer.push(Buffer.from(base64Chunk, "base64"));

    const message = JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: base64Chunk,
      sample_rate: AUDIO_SAMPLE_RATE,
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      // Buffer chunks until the connection opens
      this.pendingChunks.push(message);
    }
  }

  /**
   * Signal end-of-audio and ensure a final transcript is delivered via callbacks.
   *
   * Fast path  — if ElevenLabs' VAD already committed during streaming (natural
   *              silence was detected), the transcript is already in the session's
   *              accumulatedTranscript. We just close the WebSocket and return.
   *
   * Batch path — if the user pressed Space mid-speech (no VAD commit), streaming
   *              never emitted a committed_transcript. We fall back to the
   *              ElevenLabs REST batch API using the buffered PCM16 audio.
   *              This always returns a full transcript.
   */
  async closeGracefully(): Promise<void> {
    // Close the streaming WebSocket immediately
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.closingByClient = true;
      this.ws.close(1000, "client_closed");
    }
    this.ws = null;

    // Fast path: VAD already committed during recording
    if (this.hasReceivedCommit) {
      console.log("[STT] closeGracefully: VAD committed during streaming, done");
      return;
    }

    // Batch fallback: no VAD commit → transcribe buffered audio via REST API
    console.log(`[STT] closeGracefully: no VAD commit, falling back to batch STT (${this.audioBuffer.length} chunks)`);
    try {
      const transcript = await this.transcribeBatch();
      if (transcript) {
        console.log(`[STT] Batch transcript (${transcript.length} chars): "${transcript.slice(0, 80)}"`);
        this.callbacks.onFinal(transcript);
      } else {
        console.warn("[STT] Batch transcription returned empty result");
      }
    } catch (err) {
      console.error("[STT] Batch transcription failed:", err);
    }
  }

  close(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.closingByClient = true;
      this.ws.close(1000, "client_closed");
      return;
    }

    this.ws = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async transcribeBatch(): Promise<string> {
    if (!this.audioBuffer.length) return "";

    const pcmData = Buffer.concat(this.audioBuffer);
    if (!pcmData.length) return "";

    const wavData = this.buildWav(pcmData);

    const formData = new FormData();
    formData.append("file", new Blob([wavData], { type: "audio/wav" }), "audio.wav");
    formData.append("model_id", "scribe_v1");
    formData.append("language_code", "en");

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "(unreadable)");
      throw new Error(`ElevenLabs batch STT ${response.status}: ${errText}`);
    }

    const result = (await response.json()) as { text?: string };
    return result.text?.trim() ?? "";
  }

  /** Wraps raw PCM16 mono audio in a minimal WAV container. */
  private buildWav(pcmData: Buffer): Buffer {
    const numChannels = 1;
    const sampleRate = AUDIO_SAMPLE_RATE;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length;

    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);       // PCM = 1
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }
}
