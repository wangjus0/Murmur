import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import { createWakeDetectionRouter } from "../../apps/server/src/routes/wake-detection.ts";

test("POST /api/wake-detect detects wake phrase without orchestrating a turn", async () => {
  let transcribeCalls = 0;
  let orchestratorCalls = 0;

  const app = express();
  app.use(express.json());
  app.use(
    "/api/wake-detect",
    createWakeDetectionRouter("elevenlabs-test-key", {
      transcribe: async () => {
        transcribeCalls += 1;
        return "Hey, Murmur.";
      },
    })
  );

  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/wake-detect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ audioChunks: ["AAAA"] }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: "wake_detected" });
    assert.equal(transcribeCalls, 1);
    assert.equal(orchestratorCalls, 0);
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

test("POST /api/wake-detect returns no_match for non-wake transcript", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/wake-detect",
    createWakeDetectionRouter("elevenlabs-test-key", {
      transcribe: async () => "open my calendar",
    })
  );

  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/wake-detect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ audioChunks: ["AAAA"] }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: "no_match" });
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
