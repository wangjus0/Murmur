import assert from "node:assert/strict";
import test from "node:test";

import { resolveServerHttpOrigin } from "../../apps/client/src/lib/server-origin.ts";

test("resolveServerHttpOrigin prefers Electron desktop websocket origin", () => {
  const result = resolveServerHttpOrigin(
    {
      protocol: "http:",
      host: "localhost:5173",
    },
    "ws://127.0.0.1:3001/ws"
  );

  assert.equal(result, "http://127.0.0.1:3001");
});

test("resolveServerHttpOrigin uses current HTTP origin without desktop socket", () => {
  const result = resolveServerHttpOrigin({
    protocol: "http:",
    host: "localhost:5173",
  });

  assert.equal(result, "http://localhost:5173");
});
