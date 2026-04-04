export type SessionStatus = "active" | "completed" | "error" | "interrupted" | "closed";

export interface SessionConnectionContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: SessionStatus;
  readonly connection: SessionConnectionContext;
  readonly errorMessage: string | null;
}

export interface TranscriptRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface ActionEventRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface SessionSnapshot {
  readonly session: SessionRecord;
  readonly transcripts: readonly TranscriptRecord[];
  readonly actionEvents: readonly ActionEventRecord[];
}

export interface CreateSessionInput {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly connection: SessionConnectionContext;
}

export interface EndSessionInput {
  readonly sessionId: string;
  readonly endedAt: string;
  readonly status: Exclude<SessionStatus, "active">;
  readonly errorMessage: string | null;
}

export interface TranscriptInput {
  readonly id: string;
  readonly sessionId: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface ActionEventInput {
  readonly id: string;
  readonly sessionId: string;
  readonly message: string;
  readonly createdAt: string;
}
