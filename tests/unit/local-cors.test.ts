import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalCorsMiddleware,
  isAllowedLocalCorsOrigin,
} from "../../apps/server/src/http/local-cors.ts";

test("isAllowedLocalCorsOrigin accepts local renderer origins", () => {
  assert.equal(isAllowedLocalCorsOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedLocalCorsOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isAllowedLocalCorsOrigin("null"), true);
});

test("isAllowedLocalCorsOrigin rejects external origins", () => {
  assert.equal(isAllowedLocalCorsOrigin("https://example.com"), false);
  assert.equal(isAllowedLocalCorsOrigin("not a url"), false);
});

test("createLocalCorsMiddleware answers local preflight", () => {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let ended = false;
  let nextCalled = false;

  const middleware = createLocalCorsMiddleware();
  middleware(
    {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
      },
    } as never,
    {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      status(code: number) {
        statusCode = code;
        return this;
      },
      end() {
        ended = true;
      },
    } as never,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(statusCode, 204);
  assert.equal(ended, true);
  assert.equal(nextCalled, false);
  assert.equal(headers.get("Access-Control-Allow-Origin"), "http://localhost:5173");
  assert.equal(headers.get("Access-Control-Allow-Headers"), "content-type,x-murmur-browser-use-api-key");
});
