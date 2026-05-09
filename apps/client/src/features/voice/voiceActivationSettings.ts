export const VOICE_ACTIVATION_STORAGE_KEY = "murmur:voice-activation-enabled";
export const VOICE_ACTIVATION_SETTINGS_EVENT = "murmur:voice-activation-settings-change";

export function readVoiceActivationEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_ACTIVATION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistVoiceActivationEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(VOICE_ACTIVATION_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // no-op in restricted runtimes
  }

  window.dispatchEvent(
    new CustomEvent(VOICE_ACTIVATION_SETTINGS_EVENT, {
      detail: { enabled },
    })
  );
}

export function isVoiceActivationSettingsEvent(
  event: Event
): event is CustomEvent<{ enabled: boolean }> {
  return (
    event instanceof CustomEvent &&
    typeof event.detail === "object" &&
    event.detail !== null &&
    typeof event.detail.enabled === "boolean"
  );
}
