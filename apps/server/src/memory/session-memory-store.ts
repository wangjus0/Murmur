import type {
  ActionEventInput,
  ActionEventRecord,
  CreateSessionInput,
  EndSessionInput,
  SessionRecord,
  SessionSnapshot,
  TranscriptInput,
  TranscriptRecord,
} from "../modules/session/session-types.js";

const MAX_EVENTS_PER_SESSION = 1000;

export class SessionMemoryStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly transcriptBySession = new Map<string, readonly TranscriptRecord[]>();
  private readonly actionEventsBySession = new Map<string, readonly ActionEventRecord[]>();

  createSession(input: CreateSessionInput): SessionRecord {
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      return existing;
    }

    const record: SessionRecord = {
      sessionId: input.sessionId,
      startedAt: input.startedAt,
      endedAt: null,
      status: "active",
      connection: {
        ip: input.connection.ip,
        userAgent: input.connection.userAgent,
      },
      errorMessage: null,
    };

    this.sessions.set(input.sessionId, record);
    this.transcriptBySession.set(input.sessionId, []);
    this.actionEventsBySession.set(input.sessionId, []);

    return record;
  }

  appendTranscript(input: TranscriptInput): TranscriptRecord | null {
    if (!this.sessions.has(input.sessionId)) {
      return null;
    }

    const transcript: TranscriptRecord = {
      id: input.id,
      sessionId: input.sessionId,
      text: input.text,
      createdAt: input.createdAt,
    };

    const existing = this.transcriptBySession.get(input.sessionId) ?? [];
    const updated = this.limitRecords([...existing, transcript]);
    this.transcriptBySession.set(input.sessionId, updated);

    return transcript;
  }

  appendActionEvent(input: ActionEventInput): ActionEventRecord | null {
    if (!this.sessions.has(input.sessionId)) {
      return null;
    }

    const actionEvent: ActionEventRecord = {
      id: input.id,
      sessionId: input.sessionId,
      message: input.message,
      createdAt: input.createdAt,
    };

    const existing = this.actionEventsBySession.get(input.sessionId) ?? [];
    const updated = this.limitRecords([...existing, actionEvent]);
    this.actionEventsBySession.set(input.sessionId, updated);

    return actionEvent;
  }

  markSessionEnded(input: EndSessionInput): SessionRecord | null {
    const existing = this.sessions.get(input.sessionId);
    if (!existing) {
      return null;
    }

    const updated: SessionRecord = {
      ...existing,
      endedAt: input.endedAt,
      status: input.status,
      errorMessage: input.errorMessage,
    };

    this.sessions.set(input.sessionId, updated);
    return updated;
  }

  getSessionSnapshot(sessionId: string): SessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const transcripts = this.transcriptBySession.get(sessionId) ?? [];
    const actionEvents = this.actionEventsBySession.get(sessionId) ?? [];

    return {
      session: {
        ...session,
        connection: {
          ip: session.connection.ip,
          userAgent: session.connection.userAgent,
        },
      },
      transcripts: transcripts.map((entry) => ({ ...entry })),
      actionEvents: actionEvents.map((entry) => ({ ...entry })),
    };
  }

  private limitRecords<T>(records: readonly T[]): readonly T[] {
    if (records.length <= MAX_EVENTS_PER_SESSION) {
      return records;
    }

    return records.slice(records.length - MAX_EVENTS_PER_SESSION);
  }
}
