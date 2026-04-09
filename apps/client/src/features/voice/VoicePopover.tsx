import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useSessionStore } from "../../store/session";
import { useAudioPlayer } from "../narration/useAudioPlayer";
import { useMicrophone } from "./useMicrophone";
import { TextContextPanel } from "./TextContextPanel";
import { ClarificationCard } from "./ClarificationCard";
import { MarkdownResponse } from "./MarkdownResponse";
import { resolvePopoverHeight } from "./voicePopoverLayout";

// Delay (in ms) before the renderer is allowed to send repositionPopover /
// resizePopover IPC calls after mount. This gives the main process time to
// finish snapPopoverToCenter() so our calls don't fight against it.
const IPC_READY_DELAY_MS = 80;
const BUSY_TURN_STATES = new Set(["thinking", "acting", "speaking"]);
const BAR_COUNT = 9;
const BASE_BAR_SCALE = [0.34, 0.5, 0.72, 0.9, 0.76, 0.92, 0.7, 0.52, 0.36];
const FLAT_SCALE = new Array(BAR_COUNT).fill(0.12);
const SILENCE_THRESHOLD = 0.12;
const SILENCE_TIMEOUT_MS = 3000;
const WORKING_EXPANDED_WIDTH = 280;
const WORKING_EXPANDED_HEIGHT = 96;
const WORKING_NOTCH_WIDTH = 96;
const WORKING_NOTCH_HEIGHT = 20;
const REDUCED_MOTION_BAR_SCALE = [0.2, 0.32, 0.48, 0.62, 0.5, 0.62, 0.48, 0.32, 0.2];

export function VoicePopover() {
  const audioPlayer = useAudioPlayer();
  const { sendStartSession, sendAudioChunk, sendAudioEnd, sendInterrupt, sendTextInput } = useSession(audioPlayer);

  const turnState = useSessionStore((s) => s.turnState);
  const narrationText = useSessionStore((s) => s.narrationText);
  const error = useSessionStore((s) => s.error);
  const setError = useSessionStore((s) => s.setError);
  const clarificationQuestion = useSessionStore((s) => s.clarificationQuestion);
  const [barScales, setBarScales] = useState<number[]>(FLAT_SCALE);
  const [workingElapsed, setWorkingElapsed] = useState(0);
  const [workingExpanded, setWorkingExpanded] = useState(false);
  const [overlayCollapsed, setOverlayCollapsed] = useState(false);
  const [expandingFromNotch, setExpandingFromNotch] = useState(false);
  const [entered, setEntered] = useState(false);
  const [statusKey, setStatusKey] = useState(0);
  const [textPanelOpen, setTextPanelOpen] = useState(false);
  const [contextText, setContextText] = useState("");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [ipcLayoutReadyTick, setIpcLayoutReadyTick] = useState(0);
  const contextTextRef = useRef("");
  const prevIsWorkingForLayoutRef = useRef(false);
  const isRecordingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const prevStatusRef = useRef("");
  const idleAnimFrameRef = useRef<number | null>(null);
  const prevWorkingRef = useRef(false);
  const prevOverlayCollapsedRef = useRef(false);
  const workingNotchButtonRef = useRef<HTMLButtonElement>(null);
  const workingNotchLineRef = useRef<HTMLSpanElement>(null);
  const pillButtonRef = useRef<HTMLButtonElement>(null);
  const textToggleButtonRef = useRef<HTMLButtonElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);
  const clarificationCardRef = useRef<HTMLDivElement>(null);
  const responseCardContainerRef = useRef<HTMLDivElement>(null);
  const responseScrollRef = useRef<HTMLDivElement>(null);
  const prevTextPanelOpenStateRef = useRef(false);
  const prevClarificationVisibleRef = useRef(false);
  const prevResponseVisibleRef = useRef(false);

  // Gate all repositionPopover / resizePopover IPC calls until after the main
  // process has finished snapPopoverToCenter(). Without this, effects that fire
  // synchronously on mount race against the snap and land the window at a
  // wrong location. Also used to suppress IPC calls during unmount.
  const ipcReadyRef = useRef(false);

  // Treat audio playback as effectively "speaking" even after server sends idle
  const effectiveState = audioPlayer.isPlaying && turnState === "idle" ? "speaking" : turnState;
  const micDisabled = BUSY_TURN_STATES.has(effectiveState);

  const sendAudioEndWithContext = useCallback(() => {
    const ctx = contextTextRef.current.trim() || undefined;
    sendAudioEnd(ctx);
    contextTextRef.current = "";
    setContextText("");
  }, [sendAudioEnd]);

  const { startRecording, stopRecording, isRecording } = useMicrophone({
    onAudioChunk: sendAudioChunk,
    onStart: sendStartSession,
    onStop: sendAudioEndWithContext,
    onError: setError,
    onAudioLevel: (level) => {
      // Auto-stop after 3s of silence (only after user has spoken)
      if (isRecordingRef.current) {
        if (level > SILENCE_THRESHOLD) {
          hasSpokenRef.current = true;
          silenceStartRef.current = null;
        } else if (hasSpokenRef.current) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current >= SILENCE_TIMEOUT_MS) {
            stopRecordingRef.current?.();
            setBarScales(FLAT_SCALE);
            return;
          }
        }
      }

      if (prefersReducedMotion) {
        const reduced = Math.max(0.18, Math.min(0.72, 0.18 + level * 0.56));
        setBarScales(REDUCED_MOTION_BAR_SCALE.map((base) => Number((base * reduced * 1.85).toFixed(3))));
        return;
      }

      setBarScales((prev) => {
        return prev.map((prevScale, index) => {
          const base = BASE_BAR_SCALE[index] ?? 0.5;
          const jitter = ((index % 3) - 1) * 0.04;
          const target = Math.max(0.08, Math.min(1.2, 0.08 + level * base * 1.5 + jitter));
          const smoothing = level > prevScale ? 0.65 : 0.3;
          const next = prevScale * (1 - smoothing) + target * smoothing;
          return Number(next.toFixed(3));
        });
      });
    },
  });

  // Keep stopRecording ref current for the silence auto-stop
  stopRecordingRef.current = stopRecording;
  // Keep contextText ref in sync for use in sendAudioEndWithContext
  contextTextRef.current = contextText;

  const runUiTransition = useCallback((update: () => void) => {
    update();
  }, []);

  const morphSurfaceFromPill = useCallback((surface: HTMLDivElement | null, sourceEl?: HTMLElement | null) => {
    if (!surface || prefersReducedMotion || overlayCollapsed) return;
    const source = sourceEl ?? pillButtonRef.current;
    if (!source) return;

    const sourceRect = source.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    if (sourceRect.width <= 0 || surfaceRect.width <= 0 || surfaceRect.height <= 0) return;

    const fromCenterX = sourceRect.left + sourceRect.width / 2;
    const fromCenterY = sourceRect.top + sourceRect.height / 2;
    const toCenterX = surfaceRect.left + surfaceRect.width / 2;
    const toCenterY = surfaceRect.top + surfaceRect.height / 2;
    const dx = fromCenterX - toCenterX;
    const dy = fromCenterY - toCenterY;
    const sx = Math.max(0.3, Math.min(1.2, sourceRect.width / surfaceRect.width));
    const sy = Math.max(0.25, Math.min(1.1, sourceRect.height / surfaceRect.height));

    surface.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`,
        },
        {
          opacity: 1,
          transform: "translate3d(0, 0, 0) scale(1, 1)",
        },
      ],
      {
        duration: 270,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      },
    );
  }, [overlayCollapsed, prefersReducedMotion]);

  // Show response card when narration text exists and we're speaking or just finished
  const showResponseCard = Boolean(narrationText) && (effectiveState === "speaking" || effectiveState === "idle") && !isRecording;
  const isWorking = effectiveState === "thinking" || effectiveState === "acting";
  const isLiveState = isRecording || effectiveState === "speaking" || isWorking || effectiveState === "listening";
  const pillStateClass = error
    ? "voice-pill-wrapper--error"
    : isRecording
      ? "voice-pill-wrapper--recording"
      : isWorking
        ? "voice-pill-wrapper--working"
        : effectiveState === "speaking"
          ? "voice-pill-wrapper--speaking"
          : effectiveState === "listening"
            ? "voice-pill-wrapper--listening"
            : "";
  const showWorkingNotch = isWorking && !workingExpanded;
  const showCollapsedNotch = overlayCollapsed || showWorkingNotch;
  const showNotchVisual = showCollapsedNotch;

  // CSS @keyframes often don’t repaint in the transparent Electron popover; drive motion with rAF.
  useLayoutEffect(() => {
    const motionAllowed =
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!isWorking || !showNotchVisual || !motionAllowed) {
      return;
    }

    let rafId = 0;
    let alive = true;
    let nullFrames = 0;
    const t0 = performance.now();

    const tick = (now: number) => {
      if (!alive) return;
      const line = workingNotchLineRef.current;
      const btn = workingNotchButtonRef.current;
      if (!line || !btn) {
        nullFrames += 1;
        if (nullFrames < 90) {
          rafId = requestAnimationFrame(tick);
        }
        return;
      }
      nullFrames = 0;
      const t = (now - t0) / 1000;
      const scale = 1 + 0.26 * Math.sin(t * Math.PI * 2 * 2.15);
      const tx = 9 * Math.sin(t * Math.PI * 2 * 1.7);
      line.style.transformOrigin = "center";
      line.style.transform = `scaleX(${scale}) translateX(${tx}px)`;
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 1.3);
      line.style.boxShadow = [
        "0 1px 0 rgba(255,255,255,0.08)",
        "0 0 0 1px rgba(0,0,0,0.38)",
        `0 0 ${16 + pulse * 32}px rgba(120,160,255,${0.55 + pulse * 0.4})`,
      ].join(", ");
      btn.style.boxShadow =
        pulse > 0.3
          ? `0 0 ${20 + pulse * 28}px rgba(120,160,255,${0.45 + pulse * 0.4})`
          : "none";
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      workingNotchLineRef.current?.style.removeProperty("transform");
      workingNotchLineRef.current?.style.removeProperty("box-shadow");
      workingNotchButtonRef.current?.style.removeProperty("box-shadow");
    };
  }, [isWorking, showNotchVisual]);

  const workingLabel =
    workingElapsed < 6 ? "Investigating..." :
    workingElapsed < 18 ? "Working on it..." :
    "Almost done...";

  const statusMessage = error
    ? error
    : isRecording
      ? "Listening..."
      : effectiveState === "thinking"
        ? workingLabel
        : effectiveState === "acting"
          ? workingLabel
          : effectiveState === "speaking"
            ? "Responding..."
            : effectiveState === "listening"
              ? "Processing..."
              : "Press Space";

  // Bump statusKey to re-trigger fade animation when text changes
  useEffect(() => {
    if (statusMessage !== prevStatusRef.current) {
      prevStatusRef.current = statusMessage;
      setStatusKey((k) => k + 1);
    }
  }, [statusMessage]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => {
      setPrefersReducedMotion(media.matches);
    };
    handleChange();
    media.addEventListener("change", handleChange);
    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (isWorking && !prevWorkingRef.current) {
      setWorkingExpanded(false);
    }
    prevWorkingRef.current = isWorking;
  }, [isWorking]);

  useEffect(() => {
    const unsub = window.desktop?.shortcut?.onPopoverCollapsedChange?.((collapsed) => {
      setOverlayCollapsed(collapsed);
    });
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    const wasCollapsed = prevOverlayCollapsedRef.current;
    if (wasCollapsed && !overlayCollapsed) {
      setExpandingFromNotch(true);
    }

    if (overlayCollapsed) {
      setExpandingFromNotch(false);
    }

    prevOverlayCollapsedRef.current = overlayCollapsed;
  }, [overlayCollapsed]);

  // Drive an organic idle wave on the bars when fully idle (not recording, not in any
  // other animated state). All other states have their own animation in the effect below.
  useEffect(() => {
    const shouldAnimate = !prefersReducedMotion && !overlayCollapsed && !isRecording && effectiveState === "idle";

    if (!shouldAnimate) {
      if (idleAnimFrameRef.current !== null) {
        cancelAnimationFrame(idleAnimFrameRef.current);
        idleAnimFrameRef.current = null;
      }
      return;
    }

    let lastTick = 0;
    const TICK_MS = 32; // ~30 fps — smooth enough with the 55ms CSS height transition

    const tick = (now: number) => {
      idleAnimFrameRef.current = requestAnimationFrame(tick);
      if (now - lastTick < TICK_MS) return;
      lastTick = now;

      const t = now / 1000;
      setBarScales(Array.from({ length: BAR_COUNT }, (_, i) => {
        const phase = (i / (BAR_COUNT - 1)) * Math.PI * 1.6;
        const a = Math.sin(t * 1.3 + phase) * 0.5 + 0.5;
        const b = Math.sin(t * 2.7 + phase * 0.8 + 1.1) * 0.5 + 0.5;
        return Number((0.14 + a * 0.22 + b * 0.14).toFixed(3));
      }));
    };

    idleAnimFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (idleAnimFrameRef.current !== null) {
        cancelAnimationFrame(idleAnimFrameRef.current);
        idleAnimFrameRef.current = null;
      }
    };
  }, [isRecording, effectiveState, overlayCollapsed, prefersReducedMotion]);

  useEffect(() => {
    if (!prefersReducedMotion) return;
    if (overlayCollapsed) return;

    if (isRecording) {
      setBarScales(REDUCED_MOTION_BAR_SCALE);
      return;
    }

    if (effectiveState === "speaking") {
      setBarScales([0.24, 0.32, 0.46, 0.56, 0.64, 0.56, 0.46, 0.32, 0.24]);
      return;
    }

    if (isWorking) {
      setBarScales([0.16, 0.2, 0.24, 0.28, 0.32, 0.28, 0.24, 0.2, 0.16]);
      return;
    }

    setBarScales(FLAT_SCALE);
  }, [prefersReducedMotion, overlayCollapsed, isRecording, effectiveState, isWorking]);

  // Entrance animation on mount; also arm the IPC gate after a short delay so
  // that initial effects (which fire synchronously on mount) don't race against
  // the main-process snapPopoverToCenter() call that happens before show().
  useEffect(() => {
    const rafId = requestAnimationFrame(() => setEntered(true));
    const gateId = setTimeout(() => {
      ipcReadyRef.current = true;
      // Trigger a layout recompute for UI state changes that happened before
      // IPC became ready (e.g. opening context panel immediately after show).
      setIpcLayoutReadyTick((tick) => tick + 1);
    }, IPC_READY_DELAY_MS);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(gateId);
      // Disarm on unmount so any lingering async effects don't fire IPC.
      ipcReadyRef.current = false;
    };
  }, []);

  // Auto-show overlay when the response card becomes visible
  useEffect(() => {
    if (showResponseCard) {
      window.desktop?.shortcut?.showPopover?.();
    }
  }, [showResponseCard]);

  // Collapse text panel when agent starts working
  useEffect(() => {
    if (effectiveState === "thinking" || effectiveState === "acting") {
      setTextPanelOpen(false);
    }
  }, [effectiveState]);

  // Auto-scroll response card to bottom as narration text streams in
  useEffect(() => {
    if (responseScrollRef.current) {
      responseScrollRef.current.scrollTop = responseScrollRef.current.scrollHeight;
    }
  }, [narrationText]);

  useEffect(() => {
    const justOpened = textPanelOpen && !prevTextPanelOpenStateRef.current;
    prevTextPanelOpenStateRef.current = textPanelOpen;
    if (!justOpened) return;
    const raf = requestAnimationFrame(() => {
      morphSurfaceFromPill(textPanelRef.current, textToggleButtonRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [textPanelOpen, morphSurfaceFromPill]);

  useEffect(() => {
    const clarificationVisible = Boolean(clarificationQuestion) && !showCollapsedNotch;
    const justOpened = clarificationVisible && !prevClarificationVisibleRef.current;
    prevClarificationVisibleRef.current = clarificationVisible;
    if (!justOpened) return;
    const raf = requestAnimationFrame(() => {
      morphSurfaceFromPill(clarificationCardRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [clarificationQuestion, showCollapsedNotch, morphSurfaceFromPill]);

  useEffect(() => {
    const justOpened = showResponseCard && !prevResponseVisibleRef.current;
    prevResponseVisibleRef.current = showResponseCard;
    if (!justOpened) return;
    const raf = requestAnimationFrame(() => {
      morphSurfaceFromPill(responseCardContainerRef.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [showResponseCard, morphSurfaceFromPill]);

  const measurePopoverHeight = useCallback(() => {
    if (typeof window === "undefined") return null;
    const screen = screenRef.current;
    const shell = shellRef.current;
    if (!screen || !shell) return null;

    const shellHeight = Math.ceil(shell.getBoundingClientRect().height);
    const styles = window.getComputedStyle(screen);
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    return Math.ceil(shellHeight + paddingTop + paddingBottom);
  }, []);

  // Resize window when response card/text panel/state changes.
  // Clarification and working states take precedence over generic sizing.
  useEffect(() => {
    const leavingWorking = prevIsWorkingForLayoutRef.current && !isWorking;
    prevIsWorkingForLayoutRef.current = isWorking;
    if (!ipcReadyRef.current) {
      return;
    }
    if (overlayCollapsed) {
      return;
    }

    if (clarificationQuestion) {
      const targetHeight = resolvePopoverHeight({
        showResponseCard,
        textPanelOpen,
        clarificationVisible: true,
        measuredHeight: measurePopoverHeight(),
      });
      // Clarification surface sits above the pill and should expand upward.
      window.desktop?.shortcut?.resizePopover?.(430, targetHeight, true);
      window.desktop?.shortcut?.repositionPopover?.("center");
      return;
    }

    if (isWorking) {
      const width = workingExpanded ? WORKING_EXPANDED_WIDTH : WORKING_NOTCH_WIDTH;
      const height = workingExpanded ? WORKING_EXPANDED_HEIGHT : WORKING_NOTCH_HEIGHT;
      // Keep bottom edge fixed while shrinking/expanding and then snap to
      // bottom-center so the notch/pill never drifts or disappears.
      window.desktop?.shortcut?.resizePopover?.(width, height, true);
      window.desktop?.shortcut?.repositionPopover?.("bottom-center");
      return;
    }

    const targetHeight = resolvePopoverHeight({
      showResponseCard,
      textPanelOpen,
      clarificationVisible: false,
      measuredHeight: measurePopoverHeight(),
    });
    
    // The text context panel is rendered above the pill in the shell flow,
    // so opening it must grow the window upward to keep the pill anchored.
    const growUpward = textPanelOpen;
    
    if (leavingWorking) {
      // When leaving working/notch, width changes from 96/280 -> 430. Resize
      // first so center targeting uses final geometry (prevents X offset drift).
      window.desktop?.shortcut?.resizePopover?.(430, targetHeight, growUpward);
      window.desktop?.shortcut?.repositionPopover?.("center");
      return;
    }
    // Any non-working state should be centered. This is especially important
    // when leaving working while collapsed: once the overlay expands again, we
    // must explicitly recover from the bottom-center notch position.
    window.desktop?.shortcut?.repositionPopover?.("center");
    // For textPanelOpen: grow upward so the panel above the pill stays visible.
    window.desktop?.shortcut?.resizePopover?.(430, targetHeight, growUpward);
  }, [showResponseCard, textPanelOpen, effectiveState, isWorking, workingExpanded, clarificationQuestion, overlayCollapsed, ipcLayoutReadyTick, measurePopoverHeight]);

  // Re-apply the correct window size whenever the popover is toggled back on.
  // When the overlay is hidden and re-shown, the main process resets the window
  // to its base height (130px). Since showResponseCard/textPanelOpen haven't
  // changed, the resize effect above won't re-run — so we listen for the
  // "popover:did-show" event and re-send the correct size here.
  useEffect(() => {
    const unsub = window.desktop?.shortcut?.onPopoverDidShow?.(() => {
      setExpandingFromNotch(false);
      if (!ipcReadyRef.current) return;
      if (overlayCollapsed) return;

      if (clarificationQuestion) {
        const targetHeight = resolvePopoverHeight({
          showResponseCard,
          textPanelOpen,
          clarificationVisible: true,
          measuredHeight: measurePopoverHeight(),
        });
        window.desktop?.shortcut?.repositionPopover?.("center");
        window.desktop?.shortcut?.resizePopover?.(430, targetHeight, true);
        return;
      }

      if (isWorking) {
        const width = workingExpanded ? WORKING_EXPANDED_WIDTH : WORKING_NOTCH_WIDTH;
        const height = workingExpanded ? WORKING_EXPANDED_HEIGHT : WORKING_NOTCH_HEIGHT;
        window.desktop?.shortcut?.resizePopover?.(width, height, true);
        window.desktop?.shortcut?.repositionPopover?.("bottom-center");
        return;
      }

      const targetHeight = resolvePopoverHeight({
        showResponseCard,
        textPanelOpen,
        clarificationVisible: false,
        measuredHeight: measurePopoverHeight(),
      });
      window.desktop?.shortcut?.repositionPopover?.("center");
      // When the context panel is open, grow upward so its surface remains
      // fully inside the transparent window bounds.
      window.desktop?.shortcut?.resizePopover?.(430, targetHeight, textPanelOpen);
    });
    return () => unsub?.();
  }, [showResponseCard, textPanelOpen, effectiveState, isWorking, workingExpanded, clarificationQuestion, overlayCollapsed, measurePopoverHeight]);

  // Animate bars when speaking, go flat when idle
  useEffect(() => {
    if (overlayCollapsed) return;
    if (prefersReducedMotion) return;

    if (effectiveState === "speaking") {
      if (ipcReadyRef.current) window.desktop?.shortcut?.repositionPopover?.("center");
      const id = setInterval(() => {
        const t = Date.now() / 1000;
        setBarScales(
          BASE_BAR_SCALE.map((base, i) => {
            const wave = Math.sin(t * 3.5 + i * 0.7) * 0.3 + 0.15;
            return Number((base * 0.5 + wave).toFixed(3));
          })
        );
      }, 40);
      return () => clearInterval(id);
    }

    if (isWorking) {
      setWorkingElapsed(0);
      const startTime = Date.now();
      const elapsedId = setInterval(() => {
        setWorkingElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      if (ipcReadyRef.current) window.desktop?.shortcut?.repositionPopover?.("bottom-center");
      const id = setInterval(() => {
        const t = Date.now() / 1000;
        setBarScales(
          FLAT_SCALE.map((base, i) => {
            const wave = Math.sin(t * 4 - i * 0.6) * 0.08 + 0.04;
            return Number((base + Math.max(0, wave)).toFixed(3));
          })
        );
      }, 40);
      return () => { clearInterval(id); clearInterval(elapsedId); };
    }

    if (effectiveState === "listening") {
      if (ipcReadyRef.current) window.desktop?.shortcut?.repositionPopover?.("center");
      setBarScales(FLAT_SCALE);
      return;
    }

    if (effectiveState === "idle" && !isRecordingRef.current) {
      if (ipcReadyRef.current) window.desktop?.shortcut?.repositionPopover?.("center");
      setBarScales(FLAT_SCALE);
    }
  }, [effectiveState, overlayCollapsed, prefersReducedMotion]);

  const animatePillTap = useCallback(() => {
    if (prefersReducedMotion) return;
    pillButtonRef.current?.animate(
      [
        { transform: "translateZ(0) scale(1)", offset: 0 },
        { transform: "translateZ(0) scale(0.965)", offset: 0.35 },
        { transform: "translateZ(0) scale(1.02)", offset: 0.7 },
        { transform: "translateZ(0) scale(1)", offset: 1 },
      ],
      {
        duration: 170,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    );
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    pillButtonRef.current?.animate(
      [
        { boxShadow: "0 0 0 rgba(0,0,0,0)", transform: "translateZ(0) scale(1)", offset: 0 },
        { boxShadow: "0 0 22px rgba(255,255,255,0.08)", transform: "translateZ(0) scale(1.012)", offset: 0.45 },
        { boxShadow: "0 0 0 rgba(0,0,0,0)", transform: "translateZ(0) scale(1)", offset: 1 },
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.25, 1, 0.5, 1)",
      },
    );
  }, [effectiveState, isRecording, error, prefersReducedMotion]);

  const toggleRecording = useCallback(async () => {
    animatePillTap();
    if (isRecording) {
      stopRecording();
      setBarScales(FLAT_SCALE);
      return;
    }
    setError(null);
    useSessionStore.getState().setNarrationText("");
    useSessionStore.getState().setClarificationQuestion(null);
    silenceStartRef.current = null;
    hasSpokenRef.current = false;
    const started = await startRecording();
    if (!started) {
      setBarScales(FLAT_SCALE);
    }
  }, [animatePillTap, isRecording, setError, startRecording, stopRecording]);

  const handleInterrupt = useCallback(() => {
    animatePillTap();
    sendInterrupt();
    // Optimistic reset to avoid a stuck "Processing..." UI when interrupt
    // acknowledgement arrives late or misses a state transition event.
    const state = useSessionStore.getState();
    state.setTurnState("idle");
    state.setClarificationQuestion(null);
    setBarScales(FLAT_SCALE);
    setWorkingExpanded(false);
  }, [animatePillTap, sendInterrupt]);

  const closePopover = useCallback(() => {
    // Reset session state so that when the popover re-opens the stale
    // effectiveState (e.g. "thinking", "acting") doesn't immediately
    // re-trigger repositionPopover("bottom-center") before snapPopoverToCenter
    // has had a chance to run in the main process.
    if (isRecordingRef.current) {
      stopRecording();
    }
    audioPlayer.stop();
    useSessionStore.getState().reset();
    setBarScales(FLAT_SCALE);
    window.desktop?.shortcut?.closePopover();
  }, [audioPlayer, stopRecording]);

  const handleKeyDownRef = useRef<((event: KeyboardEvent) => void) | undefined>(undefined);
  handleKeyDownRef.current = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (textPanelOpen) {
        setTextPanelOpen(false);
        return;
      }
      if (isRecording) stopRecording();
      closePopover();
      return;
    }

    if (event.key === " " && !event.repeat) {
      event.preventDefault();
      void toggleRecording();
    }
  };

  useEffect(() => {
    const originalBodyMargin = document.body.style.margin;
    const originalBodyBackground = document.body.style.background;
    const originalRootBackground = document.documentElement.style.background;
    const originalBodyOverflow = document.body.style.overflow;
    const originalRootOverflow = document.documentElement.style.overflow;

    document.body.classList.add("voice-popover-mode");
    document.body.style.margin = "0";
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.classList.remove("voice-popover-mode");
      document.body.style.margin = originalBodyMargin;
      document.body.style.background = originalBodyBackground;
      document.documentElement.style.background = originalRootBackground;
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalRootOverflow;
    };
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleKeyDownRef.current?.(event);
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      if (isRecordingRef.current) {
        stopRecording();
      }
      setBarScales(FLAT_SCALE);
      audioPlayer.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={screenRef}
      className={`voice-popover-screen ${showCollapsedNotch ? "voice-popover-screen--notch" : ""} ${expandingFromNotch ? "voice-popover-screen--expanding" : ""} ${prefersReducedMotion ? "voice-popover-screen--reduced-motion" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) setTextPanelOpen(false); }}
    >
      <section ref={shellRef} className={`voice-popover-shell ${entered ? "voice-popover-shell--entered" : ""}`}>
        {showNotchVisual && (
          <button
            ref={workingNotchButtonRef}
            type="button"
            className={`voice-bottom-notch ${isWorking ? "voice-bottom-notch--working" : ""}`}
            onClick={() => {
              if (overlayCollapsed) {
                void window.desktop?.shortcut?.showPopover?.();
                return;
              }
              setWorkingExpanded(true);
            }}
            title={overlayCollapsed ? "Expand overlay" : "Expand working view"}
            aria-label={overlayCollapsed ? "Expand overlay" : "Expand working view"}
          >
            <span ref={workingNotchLineRef} className="voice-bottom-notch-line" aria-hidden="true" />
          </button>
        )}
        {!showCollapsedNotch && clarificationQuestion && (
          <div className="voice-context-popover">
            <ClarificationCard
              question={clarificationQuestion}
              containerRef={clarificationCardRef}
              onSubmit={(answer) => {
                useSessionStore.getState().setClarificationQuestion(null);
                setTextPanelOpen(false);
                setContextText("");
                contextTextRef.current = "";
                sendTextInput(answer);
              }}
            />
          </div>
        )}
        {/* Show text panel when toggled open */}
        {!showCollapsedNotch && !clarificationQuestion && textPanelOpen && (
          <div className="voice-context-popover voice-context-popover--text">
            <TextContextPanel
              value={contextText}
              onChange={setContextText}
              containerRef={textPanelRef}
            />
          </div>
        )}
        {!showCollapsedNotch && <div className={`voice-pill-wrapper ${expandingFromNotch ? "voice-pill-wrapper--expand-in" : ""} ${isLiveState ? "voice-pill-wrapper--live" : ""} ${pillStateClass}`}>
          <span className="voice-pill-orbit" aria-hidden="true">
            <span className="voice-pill-orbit-dot" />
            <span className="voice-pill-orbit-dot" />
            <span className="voice-pill-orbit-dot" />
          </span>
          <button
            ref={pillButtonRef}
            type="button"
            className={`voice-meter-pill ${isRecording || effectiveState !== "idle" ? "voice-meter-pill-live" : ""} ${isRecording ? "voice-meter-pill--recording" : ""} ${effectiveState === "speaking" ? "voice-meter-pill--speaking" : ""} ${(effectiveState === "thinking" || effectiveState === "acting") ? "voice-meter-pill--working" : ""} ${error ? "voice-meter-pill-error" : ""}`}
            disabled={!isRecording && micDisabled}
            onClick={() => { void toggleRecording(); }}
            title={error || (isRecording ? "Recording - press Space to stop" : "Press Space to start")}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          >
            {Array.from({ length: BAR_COUNT }, (_value, index) => (
              <span
                key={index}
                className="voice-meter-bar"
                style={{
                  transform: `scaleY(${Math.max(0.08, barScales[index] ?? 0.12)})`,
                  opacity: Math.max(0.45, Math.min(1, (barScales[index] ?? 0.12) * 1.1)),
                }}
              />
            ))}
          </button>
          {(effectiveState === "thinking" || effectiveState === "acting") && (
            <button
              type="button"
              className="voice-cancel-btn"
              onClick={handleInterrupt}
              title="Cancel current task"
              aria-label="Cancel task"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
          {isWorking && !overlayCollapsed && (
            <button
              type="button"
              className="voice-cancel-btn voice-working-collapse-btn"
              onClick={() => setWorkingExpanded(false)}
              title="Collapse to bottom notch"
              aria-label="Collapse to bottom notch"
            >
              <span aria-hidden="true">⌄</span>
            </button>
          )}
          {effectiveState === "speaking" && (
            <button
              type="button"
              className="voice-cancel-btn"
              onClick={() => audioPlayer.stop()}
              title="Stop response"
              aria-label="Stop response"
            >
              <span aria-hidden="true">■</span>
            </button>
          )}
          {!isWorking && <button
            ref={textToggleButtonRef}
            type="button"
            className={`voice-cancel-btn voice-text-toggle-btn ${textPanelOpen ? "voice-text-toggle-btn--open" : ""}`}
            onClick={(event) => {
              event.preventDefault();
              if (!prefersReducedMotion) {
                event.currentTarget.animate(
                  [
                    { transform: textPanelOpen ? "translateY(-50%) rotate(-90deg) scale(1)" : "translateY(-50%) rotate(0deg) scale(1)" },
                    { transform: textPanelOpen ? "translateY(-50%) rotate(-90deg) scale(0.9)" : "translateY(-50%) rotate(0deg) scale(0.9)" },
                    { transform: textPanelOpen ? "translateY(-50%) rotate(-90deg) scale(1.06)" : "translateY(-50%) rotate(0deg) scale(1.06)" },
                    { transform: textPanelOpen ? "translateY(-50%) rotate(-90deg) scale(1)" : "translateY(-50%) rotate(0deg) scale(1)" },
                  ],
                  {
                    duration: 220,
                    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
                  },
                );
              }
              runUiTransition(() => {
                setTextPanelOpen((prev) => !prev);
              });
            }}
            title={textPanelOpen ? "Hide text input" : "Add context via text"}
            aria-label={textPanelOpen ? "Hide text input" : "Add context via text"}
          >
            <span aria-hidden="true">›</span>
          </button>}
        </div>}
        {!showCollapsedNotch && <p
          key={statusKey}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          title={statusMessage}
          className={`voice-popover-status ${isLiveState ? "voice-popover-status--live" : ""} ${error ? "voice-popover-status-error" : ""}`}
        >
          {statusMessage}
        </p>}
        {!showCollapsedNotch && showResponseCard && (
          <div ref={responseCardContainerRef} className="voice-response-card">
            <div className="voice-response-scroll" ref={responseScrollRef}>
              <MarkdownResponse text={narrationText} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
