import crypto from "node:crypto";
import type { WebSocket } from "ws";
import type { GoogleGenAI } from "@google/genai";
import type { TurnState, ServerEvent, ClientEvent } from "@diamond/shared";
import { parseClientEvent } from "@diamond/shared";

import { SttAdapter } from "../voice/stt.js";
import { handleTranscriptFinal } from "../orchestrator/orchestrator.js";
import { env } from "../config/env.js";

export class Session {
  readonly id: string;
  private state: TurnState = "idle";
  private ws: WebSocket;
  private ai: GoogleGenAI;
  private stt: SttAdapter | null = null;
  private accumulatedTranscript = "";

  constructor(ws: WebSocket, ai: GoogleGenAI) {
    this.id = crypto.randomUUID();
    this.ws = ws;
    this.ai = ai;

    this.ws.on("message", (raw: Buffer | string) => {
      this.handleMessage(typeof raw === "string" ? raw : raw.toString("utf-8"));
    });

    this.ws.on("close", () => {
      console.log(`[session:${this.id}] WebSocket closed`);
    });

    this.ws.on("error", (err) => {
      console.error(`[session:${this.id}] WebSocket error:`, err);
    });
  }

  // ── Outgoing ───────────────────────────────────────────────
  send(event: ServerEvent): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  setState(next: TurnState): void {
    this.state = next;
    this.send({ type: "state", state: next });
  }

  getState(): TurnState {
    return this.state;
  }

  // ── Incoming ───────────────────────────────────────────────
  private handleMessage(raw: string): void {
    let event: ClientEvent;
    try {
      event = parseClientEvent(JSON.parse(raw));
    } catch (err) {
      console.error(`[session:${this.id}] Invalid event:`, err);
      this.send({ type: "error", message: "Invalid event payload" });
      return;
    }

    switch (event.type) {
      case "start_session":
        this.onStartSession();
        break;
      case "audio_chunk":
        this.onAudioChunk(event.data);
        break;
      case "audio_end":
        this.onAudioEnd();
        break;
      case "interrupt":
        this.onInterrupt();
        break;
    }
  }

  // ── Handlers ───────────────────────────────────────────────
  private onStartSession(): void {
    console.log(`[session:${this.id}] Session started`);
    this.send({ type: "session_started", sessionId: this.id });
    this.setState("idle");
  }

  private async onAudioChunk(data: string): Promise<void> {
    if (this.state === "idle") {
      this.setState("listening");
    }

    if (!this.stt) {
      this.accumulatedTranscript = "";
      this.stt = new SttAdapter(env.ELEVEN_LABS_API_KEY, {
        onPartial: (text) => {
          this.send({ type: "transcript_partial", text });
        },
        onFinal: (text) => {
          this.accumulatedTranscript = text;
          this.send({ type: "transcript_final", text });
        },
        onError: (error) => {
          console.error(`[session:${this.id}] STT error:`, error);
          this.send({ type: "error", message: "Speech recognition error" });
        },
      });
      await this.stt.connect();
    }

    this.stt.sendAudio(data);
  }

  private async onAudioEnd(): Promise<void> {
    console.log(`[session:${this.id}] Audio stream ended`);

    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }

    const transcript = this.accumulatedTranscript.trim();
    if (transcript) {
      await handleTranscriptFinal(this, this.ai, env.ELEVEN_LABS_API_KEY, transcript);
    } else {
      this.setState("idle");
    }
  }

  private onInterrupt(): void {
    console.log(`[session:${this.id}] Interrupted`);
    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }
    this.setState("idle");
  }
}
