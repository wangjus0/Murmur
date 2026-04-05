import WebSocket from "ws";
import { TTS_VOICE_ID, TTS_MODEL_ID, TTS_OUTPUT_FORMAT } from "@murmur/shared";

export class TtsAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  synthesize(text: string, onAudioChunk: (base64Audio: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${TTS_VOICE_ID}/stream-input?model_id=${TTS_MODEL_ID}&output_format=${TTS_OUTPUT_FORMAT}`;

      const ws = new WebSocket(url, {
        headers: { "xi-api-key": this.apiKey },
      });

      ws.on("open", () => {
        console.log("[TTS] Connected to ElevenLabs");

        // Step 1: initialization message
        ws.send(
          JSON.stringify({
            text: " ",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              speed: 1.0,
            },
            generation_config: {
              chunk_length_schedule: [120, 160, 250, 290],
            },
          })
        );

        // Step 2: actual text
        ws.send(JSON.stringify({ text: text + " ", flush: true }));

        // Step 3: close signal
        ws.send(JSON.stringify({ text: "" }));
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.audio) {
            onAudioChunk(msg.audio);
          }

          if (msg.isFinal) {
            ws.close();
            resolve();
          }
        } catch (err) {
          console.error("[TTS] Failed to parse message:", err);
        }
      });

      ws.on("error", (err) => {
        console.error("[TTS] WebSocket error:", err.message);
        reject(err);
      });

      ws.on("close", () => {
        console.log("[TTS] Connection closed");
      });
    });
  }
}
