import assert from "node:assert/strict";
import test from "node:test";
import { resolvePopoverHeight } from "../../apps/client/src/features/voice/voicePopoverLayout.ts";

test("uses measured height when content exceeds fallback", () => {
  const result = resolvePopoverHeight({
    showResponseCard: false,
    textPanelOpen: true,
    clarificationVisible: false,
    measuredHeight: 342,
  });

  assert.equal(result, 342);
});

test("text panel open keeps popover above base height without measurement", () => {
  const result = resolvePopoverHeight({
    showResponseCard: false,
    textPanelOpen: true,
    clarificationVisible: false,
    measuredHeight: null,
  });

  assert.equal(result, 290);
});

test("clarification view enforces minimum height", () => {
  const result = resolvePopoverHeight({
    showResponseCard: false,
    textPanelOpen: false,
    clarificationVisible: true,
    measuredHeight: 220,
  });

  assert.equal(result, 260);
});
