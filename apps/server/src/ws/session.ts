import crypto from "node:crypto";
import type { WebSocket } from "ws";
import type { RawData } from "ws";
import type { GoogleGenAI } from "@google/genai";
import type { ServerEvent, ClientEvent } from "@diamond/shared";
import { parseClientEvent } from "@diamond/shared";

import { SttAdapter } from "../voice/stt.js";
import { handleTranscriptFinal } from "../orchestrator/orchestrator.js";
import { env } from "../config/env.js";
import type {
  SessionPersistence,
  SessionTerminalStatus,
} from "../persistence/session-persistence.js";
import type { BrowserAdapter } from "../tools/browser/adapter.js";

type SessionTurnState = Extract<ServerEvent, { type: "state" }>["state"];

export class Session {
  readonly id: string;
  private state: SessionTurnState = "idle";
  private ws: WebSocket;
  private ai: GoogleGenAI;
  private persistence: SessionPersistence;
  private stt: SttAdapter | null = null;
  private accumulatedTranscript = "";
  private hasFinalizedRun = false;
  private narrationSequence = 0;
  private browserAdapter: BrowserAdapter | null = null;

  constructor(ws: WebSocket, ai: GoogleGenAI, persistence: SessionPersistence) {
    this.id = crypto.randomUUID();
    this.ws = ws;
    this.ai = ai;
    this.persistence = persistence;

    this.ws.on("message", (raw: RawData) => {
      this.handleMessage(normalizeRawSocketData(raw));
    });

    this.ws.on("close", () => {
      console.log(`[session:${this.id}] WebSocket closed`);
      this.finishSession("disconnected");
    });

    this.ws.on("error", (err) => {
      console.error(`[session:${this.id}] WebSocket error:`, err);
    });
  }

  // ── Outgoing ───────────────────────────────────────────────
  send(event: ServerEvent): void {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(event));
    }

    this.persistOutgoingEvent(event);

    if (event.type === "done") {
      this.finishSession("completed");
      return;
    }

    if (event.type === "error") {
      this.finishSession("errored", event.message);
    }
  }

  setState(next: SessionTurnState): void {
    this.state = next;
    this.send({ type: "state", state: next });
  }

  getState(): SessionTurnState {
    return this.state;
  }

  setBrowserAdapter(adapter: BrowserAdapter | null): void {
    this.browserAdapter = adapter;
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
    this.hasFinalizedRun = false;
    this.narrationSequence = 0;
    this.persistNonBlocking(
      this.persistence.startSession({ sessionId: this.id }),
      "start session"
    );
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
    if (this.browserAdapter) {
      this.browserAdapter.cancel();
      this.browserAdapter = null;
    }
    this.setState("idle");
    this.finishSession("interrupted");
  }

  private persistOutgoingEvent(event: ServerEvent): void {
    switch (event.type) {
      case "transcript_final":
        this.persistNonBlocking(
          this.persistence.appendTranscriptFinal({
            sessionId: this.id,
            text: event.text,
          }),
          "append transcript final"
        );
        break;
      case "action_status":
        this.persistNonBlocking(
          this.persistence.appendActionEvent({
            sessionId: this.id,
            status: "running",
            step: event.message,
          }),
          "append action status"
        );
        break;
      case "narration_text": {
        const sequence = this.narrationSequence;
        this.narrationSequence += 1;
        this.persistNonBlocking(
          this.persistence.appendNarrationText({
            sessionId: this.id,
            text: event.text,
            sequence,
          }),
          "append narration text"
        );
        break;
      }
      default:
        break;
    }
  }

  private finishSession(
    status: SessionTerminalStatus,
    errorMessage?: string
  ): void {
    if (this.hasFinalizedRun) {
      return;
    }

    this.hasFinalizedRun = true;
    this.persistNonBlocking(
      this.persistence.finishSession({
        sessionId: this.id,
        status,
        errorMessage,
      }),
      `finish session as ${status}`
    );
  }

  private persistNonBlocking(task: Promise<void>, operation: string): void {
    void task.catch((error) => {
      console.error(`[session:${this.id}] Failed to ${operation}:`, error);
    });
  }
}

function normalizeRawSocketData(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf-8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf-8");
  }

  return raw.toString("utf-8");
}
