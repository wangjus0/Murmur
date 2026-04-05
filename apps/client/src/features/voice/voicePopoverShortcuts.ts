export type VoicePopoverShortcutAction = "toggle-mic" | "close" | "none";

type ResolveVoicePopoverShortcutInput = {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  canToggleMic: boolean;
};

export function resolveVoicePopoverShortcutAction({
  key,
  repeat,
  altKey,
  ctrlKey,
  metaKey,
  shiftKey,
  canToggleMic,
}: ResolveVoicePopoverShortcutInput): VoicePopoverShortcutAction {
  if (repeat) {
    return "none";
  }

  if (key === "Escape") {
    return "close";
  }

  if (!canToggleMic) {
    return "none";
  }

  const hasModifier = altKey || ctrlKey || metaKey || shiftKey;
  if (hasModifier) {
    return "none";
  }

  if (key === " " || key === "Spacebar") {
    return "toggle-mic";
  }

  return "none";
}
