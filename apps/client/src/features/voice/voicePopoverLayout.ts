export const POPOVER_BASE_HEIGHT = 130;
export const POPOVER_RESPONSE_HEIGHT = 300;
export const POPOVER_TEXT_PANEL_EXTRA_HEIGHT = 160;
export const POPOVER_CLARIFICATION_MIN_HEIGHT = 260;
export const BROWSER_PREVIEW_NORMAL_WIDTH = 760;
export const BROWSER_PREVIEW_NORMAL_HEIGHT = 560;
export const BROWSER_PREVIEW_EXPANDED_WIDTH = 1120;
export const BROWSER_PREVIEW_EXPANDED_HEIGHT = 756;
export const BROWSER_PREVIEW_SCREEN_MARGIN = 32;

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

interface ResolveBrowserPreviewSizeInput {
  expanded: boolean;
  availableWidth?: number | null;
  availableHeight?: number | null;
}

export interface BrowserPreviewSize {
  width: number;
  height: number;
}

function clampPreviewDimension(target: number, available: number | null | undefined): number {
  if (typeof available !== "number" || !Number.isFinite(available) || available <= 0) {
    return target;
  }

  const maxAvailable = Math.max(1, Math.floor(available - BROWSER_PREVIEW_SCREEN_MARGIN * 2));
  return Math.min(target, maxAvailable);
}

export function resolveBrowserPreviewSize({
  expanded,
  availableWidth,
  availableHeight,
}: ResolveBrowserPreviewSizeInput): BrowserPreviewSize {
  const targetWidth = expanded ? BROWSER_PREVIEW_EXPANDED_WIDTH : BROWSER_PREVIEW_NORMAL_WIDTH;
  const targetHeight = expanded ? BROWSER_PREVIEW_EXPANDED_HEIGHT : BROWSER_PREVIEW_NORMAL_HEIGHT;

  return {
    width: clampPreviewDimension(targetWidth, availableWidth),
    height: clampPreviewDimension(targetHeight, availableHeight),
  };
}
