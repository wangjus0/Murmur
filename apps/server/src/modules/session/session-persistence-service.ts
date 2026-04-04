import crypto from "node:crypto";
import { SessionMemoryStore } from "../../memory/session-memory-store.js";
import type {
  SessionConnectionContext,
  SessionSnapshot,
  SessionStatus,
} from "./session-types.js";

type NowProvider = () => string;
type IdProvider = () => string;

interface SessionPersistenceServiceOptions {
  readonly now?: NowProvider;
  readonly createId?: IdProvider;
}

export class SessionPersistenceService {
  private readonly now: NowProvider;
  private readonly createId: IdProvider;

  constructor(
    private readonly store: SessionMemoryStore,
    options: SessionPersistenceServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  startSession(sessionId: string, connection: SessionConnectionContext): void {
    this.store.createSession({
      sessionId,
      startedAt: this.now(),
      connection,
    });
  }

  persistTranscript(sessionId: string, text: string): void {
    this.store.appendTranscript({
      id: this.createId(),
      sessionId,
      text,
      createdAt: this.now(),
    });
  }

  persistActionEvent(sessionId: string, message: string): void {
    this.store.appendActionEvent({
      id: this.createId(),
      sessionId,
      message,
      createdAt: this.now(),
    });
  }

  endSession(
    sessionId: string,
    status: Exclude<SessionStatus, "active">,
    errorMessage: string | null = null,
  ): void {
    this.store.markSessionEnded({
      sessionId,
      endedAt: this.now(),
      status,
      errorMessage,
    });
  }

  getSessionSnapshot(sessionId: string): SessionSnapshot | null {
    return this.store.getSessionSnapshot(sessionId);
  }
}
