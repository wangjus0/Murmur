import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBrowserPreviewSize,
  resolvePopoverHeight,
} from "../../apps/client/src/features/voice/voicePopoverLayout.ts";

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

test("browser preview normal size stays at the existing window size", () => {
  const result = resolveBrowserPreviewSize({
    expanded: false,
    availableWidth: 1600,
    availableHeight: 1000,
  });

  assert.deepEqual(result, { width: 760, height: 560 });
});

test("browser preview expanded size uses the moderate-large target", () => {
  const result = resolveBrowserPreviewSize({
    expanded: true,
    availableWidth: 1600,
    availableHeight: 1000,
  });

  assert.deepEqual(result, { width: 1120, height: 756 });
});

test("browser preview expanded size clamps to the available screen", () => {
  const result = resolveBrowserPreviewSize({
    expanded: true,
    availableWidth: 1000,
    availableHeight: 700,
  });

  assert.deepEqual(result, { width: 936, height: 636 });
});
