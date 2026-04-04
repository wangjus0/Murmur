import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFormFillDraftTaskPrompt,
  buildSearchTaskPrompt,
} from "../../apps/server/src/tools/browser/adapter.ts";

test("search task prompt stays focused on read-only retrieval", () => {
  const prompt = buildSearchTaskPrompt("best tacos in san jose");

  assert.match(prompt, /google\.com/i);
  assert.match(prompt, /top 5 result titles and URLs/i);
  assert.doesNotMatch(prompt, /\bsubmit\b/i);
  assert.doesNotMatch(prompt, /\bcheckout\b/i);
});

test("form fill draft prompt explicitly blocks dangerous actions", () => {
  const prompt = buildFormFillDraftTaskPrompt("fill out a contact form");

  assert.match(prompt, /Do NOT submit the form\./i);
  assert.match(prompt, /Do NOT click any submit, pay, checkout, or confirmation buttons\./i);
  assert.match(prompt, /Report which fields were filled and with what values\./i);
});

test("form fill prompt can allow submit when enabled", () => {
  const prompt = buildFormFillDraftTaskPrompt("fill and submit this form", {
    allowSubmit: true,
  });

  assert.match(prompt, /If the user explicitly asked to submit, submit the form once/i);
  assert.match(prompt, /Never perform payment, checkout, or purchase actions\./i);
});
