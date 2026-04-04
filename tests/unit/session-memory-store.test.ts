import assert from "node:assert/strict";
import test from "node:test";

import { SessionMemoryStore } from "../../apps/server/src/memory/session-memory-store.ts";

test("creates session and returns replay snapshot", () => {
  const store = new SessionMemoryStore();

  store.createSession({
    sessionId: "session-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    connection: { ip: "127.0.0.1", userAgent: "test-agent" },
  });

  store.appendTranscript({
    id: "t-1",
    sessionId: "session-1",
    text: "hello world",
    createdAt: "2026-01-01T00:00:01.000Z",
  });

  store.appendActionEvent({
    id: "a-1",
    sessionId: "session-1",
    message: "Clicked search button",
    createdAt: "2026-01-01T00:00:02.000Z",
  });

  store.markSessionEnded({
    sessionId: "session-1",
    endedAt: "2026-01-01T00:00:03.000Z",
    status: "completed",
    errorMessage: null,
  });

  const snapshot = store.getSessionSnapshot("session-1");
  assert.ok(snapshot);
  assert.equal(snapshot.session.status, "completed");
  assert.equal(snapshot.transcripts.length, 1);
  assert.equal(snapshot.transcripts[0]?.text, "hello world");
  assert.equal(snapshot.actionEvents.length, 1);
  assert.equal(snapshot.actionEvents[0]?.message, "Clicked search button");
});

test("returns null when appending to a missing session", () => {
  const store = new SessionMemoryStore();

  const transcriptResult = store.appendTranscript({
    id: "t-1",
    sessionId: "missing",
    text: "ignored",
    createdAt: "2026-01-01T00:00:01.000Z",
  });

  const actionResult = store.appendActionEvent({
    id: "a-1",
    sessionId: "missing",
    message: "ignored",
    createdAt: "2026-01-01T00:00:02.000Z",
  });

  assert.equal(transcriptResult, null);
  assert.equal(actionResult, null);
});

test("createSession is idempotent for existing session ids", () => {
  const store = new SessionMemoryStore();

  store.createSession({
    sessionId: "session-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    connection: { ip: "127.0.0.1", userAgent: "test-agent" },
  });

  store.appendTranscript({
    id: "t-1",
    sessionId: "session-1",
    text: "first transcript",
    createdAt: "2026-01-01T00:00:01.000Z",
  });

  store.createSession({
    sessionId: "session-1",
    startedAt: "2026-01-01T00:00:05.000Z",
    connection: { ip: "10.0.0.2", userAgent: "new-agent" },
  });

  const snapshot = store.getSessionSnapshot("session-1");
  assert.ok(snapshot);
  assert.equal(snapshot.session.startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(snapshot.transcripts.length, 1);
  assert.equal(snapshot.transcripts[0]?.text, "first transcript");
});
