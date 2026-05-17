export const BACKGROUND_BLUR_GRACE_PERIOD_MS = 700;

export type VoicePopoverBlurDecisionInput = {
  openedFromBackground: boolean;
  millisecondsSinceShow: number;
};

export function shouldHideVoicePopoverOnBlur({
  openedFromBackground,
  millisecondsSinceShow,
}: VoicePopoverBlurDecisionInput): boolean {
  void millisecondsSinceShow;

  if (!openedFromBackground) {
    return true;
  }

  return false;
}

export type VoicePopoverToggleAction = "show" | "collapse";

export type VoicePopoverToggleDecisionInput = {
  intentVisible: boolean;
  hasReusableWindow: boolean;
};

export function resolveVoicePopoverToggleAction({
  intentVisible,
  hasReusableWindow,
}: VoicePopoverToggleDecisionInput): VoicePopoverToggleAction {
  if (intentVisible && hasReusableWindow) {
    return "collapse";
  }

  return "show";
}
