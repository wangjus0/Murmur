import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_BLUR_GRACE_PERIOD_MS,
  resolveVoicePopoverToggleAction,
  shouldHideVoicePopoverOnBlur,
} from "../../electron/voicePopoverBehavior.ts";

test("blur hides popover immediately when opened from focused app", () => {
  const result = shouldHideVoicePopoverOnBlur({
    openedFromBackground: false,
    millisecondsSinceShow: 1,
  });

  assert.equal(result, true);
});

test("blur does not hide popover during initial background grace period", () => {
  const result = shouldHideVoicePopoverOnBlur({
    openedFromBackground: true,
    millisecondsSinceShow: BACKGROUND_BLUR_GRACE_PERIOD_MS - 1,
  });

  assert.equal(result, false);
});

test("blur does not hide popover after background grace period elapses", () => {
  const result = shouldHideVoicePopoverOnBlur({
    openedFromBackground: true,
    millisecondsSinceShow: BACKGROUND_BLUR_GRACE_PERIOD_MS,
  });

  assert.equal(result, false);
});

test("shortcut collapses an intentionally visible reusable popover", () => {
  const result = resolveVoicePopoverToggleAction({
    intentVisible: true,
    hasReusableWindow: true,
  });

  assert.equal(result, "collapse");
});

test("shortcut opens the popover when it is collapsed to the notch", () => {
  const result = resolveVoicePopoverToggleAction({
    intentVisible: false,
    hasReusableWindow: true,
  });

  assert.equal(result, "show");
});

test("shortcut recreates instead of collapsing when visible state outlives the window", () => {
  const result = resolveVoicePopoverToggleAction({
    intentVisible: true,
    hasReusableWindow: false,
  });

  assert.equal(result, "show");
});
