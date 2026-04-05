import assert from "node:assert/strict";
import test from "node:test";
import { resolveVoicePopoverShortcutAction } from "../../apps/client/src/features/voice/voicePopoverShortcuts.ts";

const baseInput = {
  key: "",
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  canToggleMic: true,
};

test("space toggles microphone when available", () => {
  const result = resolveVoicePopoverShortcutAction({
    ...baseInput,
    key: " ",
  });

  assert.equal(result, "toggle-mic");
});

test("escape closes overlay", () => {
  const result = resolveVoicePopoverShortcutAction({
    ...baseInput,
    key: "Escape",
    canToggleMic: false,
  });

  assert.equal(result, "close");
});

test("space is ignored when a modifier key is held", () => {
  const result = resolveVoicePopoverShortcutAction({
    ...baseInput,
    key: " ",
    metaKey: true,
  });

  assert.equal(result, "none");
});

test("space is ignored when mic toggle is unavailable", () => {
  const result = resolveVoicePopoverShortcutAction({
    ...baseInput,
    key: " ",
    canToggleMic: false,
  });

  assert.equal(result, "none");
});

test("repeated keydown events are ignored", () => {
  const result = resolveVoicePopoverShortcutAction({
    ...baseInput,
    key: " ",
    repeat: true,
  });

  assert.equal(result, "none");
});
