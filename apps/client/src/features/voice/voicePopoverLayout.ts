export const POPOVER_BASE_HEIGHT = 130;
export const POPOVER_RESPONSE_HEIGHT = 300;
export const POPOVER_TEXT_PANEL_EXTRA_HEIGHT = 160;
export const POPOVER_CLARIFICATION_MIN_HEIGHT = 260;

interface ResolvePopoverHeightInput {
  showResponseCard: boolean;
  textPanelOpen: boolean;
  clarificationVisible: boolean;
  measuredHeight: number | null;
}

export function resolvePopoverHeight({
  showResponseCard,
  textPanelOpen,
  clarificationVisible,
  measuredHeight,
}: ResolvePopoverHeightInput): number {
  const measured = measuredHeight ?? 0;

  if (clarificationVisible) {
    return Math.max(POPOVER_CLARIFICATION_MIN_HEIGHT, measured);
  }

  const fallbackBase = showResponseCard ? POPOVER_RESPONSE_HEIGHT : POPOVER_BASE_HEIGHT;
  const fallbackExtra = textPanelOpen ? POPOVER_TEXT_PANEL_EXTRA_HEIGHT : 0;
  return Math.max(fallbackBase + fallbackExtra, measured);
}
