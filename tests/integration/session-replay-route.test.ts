import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import { SessionMemoryStore } from "../../apps/server/src/memory/session-memory-store.ts";
import { SessionPersistenceService } from "../../apps/server/src/modules/session/session-persistence-service.ts";
import { createSessionsRouter } from "../../apps/server/src/routes/sessions.ts";

test("GET /sessions/:sessionId returns persisted session replay data", async () => {
  const store = new SessionMemoryStore();
  const nowValues = [
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:01.000Z",
    "2026-01-01T00:00:02.000Z",
    "2026-01-01T00:00:03.000Z",
  ];
  const ids = ["t-1", "a-1"];

  const persistence = new SessionPersistenceService(store, {
    now: () => nowValues.shift() ?? "2026-01-01T00:00:59.000Z",
    createId: () => ids.shift() ?? "id-fallback",
  });

  persistence.startSession("session-1", { ip: "127.0.0.1", userAgent: "integration-test" });
  persistence.persistTranscript("session-1", "Find coffee shops");
  persistence.persistActionEvent("session-1", "Opened maps search");
  persistence.endSession("session-1", "completed");

  const app = express();
  app.use("/sessions", createSessionsRouter(persistence));

  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/sessions/session-1`);
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      session: { sessionId: string; status: string };
      transcripts: Array<{ text: string }>;
      actionEvents: Array<{ message: string }>;
    };

    assert.equal(body.session.sessionId, "session-1");
    assert.equal(body.session.status, "completed");
    assert.equal(body.transcripts[0]?.text, "Find coffee shops");
    assert.equal(body.actionEvents[0]?.message, "Opened maps search");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("GET /sessions/:sessionId returns 404 when missing", async () => {
  const store = new SessionMemoryStore();
  const persistence = new SessionPersistenceService(store);

  const app = express();
  app.use("/sessions", createSessionsRouter(persistence));

  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/sessions/does-not-exist`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
