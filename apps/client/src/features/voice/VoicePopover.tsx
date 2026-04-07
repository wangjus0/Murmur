import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useSessionStore } from "../../store/session";
import { useAudioPlayer } from "../narration/useAudioPlayer";
import { useMicrophone } from "./useMicrophone";
import { TextContextPanel } from "./TextContextPanel";
import { ClarificationCard } from "./ClarificationCard";
import { MarkdownResponse } from "./MarkdownResponse";

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
  const contextTextRef = useRef("");
  const prevTextPanelOpenRef = useRef(false);
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

  const responseCardRef = useRef<HTMLDivElement>(null);

  // Show response card when narration text exists and we're speaking or just finished
  const showResponseCard = Boolean(narrationText) && (effectiveState === "speaking" || effectiveState === "idle") && !isRecording;
  const isWorking = effectiveState === "thinking" || effectiveState === "acting";
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
              : "Press space";

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
    const shouldAnimate = !overlayCollapsed && !isRecording && effectiveState === "idle";

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
  }, [isRecording, effectiveState, overlayCollapsed]);

  // Entrance animation on mount; also arm the IPC gate after a short delay so
  // that initial effects (which fire synchronously on mount) don't race against
  // the main-process snapPopoverToCenter() call that happens before show().
  useEffect(() => {
    const rafId = requestAnimationFrame(() => setEntered(true));
    const gateId = setTimeout(() => {
      ipcReadyRef.current = true;
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

  // Reposition + resize when clarification is requested/dismissed
  useEffect(() => {
    if (overlayCollapsed) return;
    if (!ipcReadyRef.current) return;
    if (clarificationQuestion) {
      window.desktop?.shortcut?.repositionPopover?.("center");
      // Grow upward so the pill stays in place
      window.desktop?.shortcut?.resizePopover?.(430, 260, true);
    } else {
      const base = showResponseCard ? 300 : 130;
      const extra = textPanelOpen ? 110 : 0;
      // anchorBottom=true: shrink upward so the pill stays in place
      window.desktop?.shortcut?.resizePopover?.(430, base + extra, true);
    }
  }, [clarificationQuestion, overlayCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll response card to bottom as narration text streams in
  useEffect(() => {
    if (responseCardRef.current) {
      responseCardRef.current.scrollTop = responseCardRef.current.scrollHeight;
    }
  }, [narrationText]);

  // Resize window when response card/text panel/state changes.
  // Clarification and working states take precedence over generic sizing.
  useEffect(() => {
    // Always update the ref so anchorBottom is correct on the first ready call.
    const anchorBottom = textPanelOpen !== prevTextPanelOpenRef.current;
    prevTextPanelOpenRef.current = textPanelOpen;
    if (!ipcReadyRef.current) return;
    if (overlayCollapsed) return;

    if (clarificationQuestion) {
      // Keep enough vertical space for the clarification card + controls.
      window.desktop?.shortcut?.resizePopover?.(430, 260, true);
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

    const base = showResponseCard ? 300 : 130;
    const extra = textPanelOpen ? 110 : 0;
    // Anchor bottom (grow upward) only when the text panel itself toggled,
    // so the pill stays in place. Response card grows downward normally.
    window.desktop?.shortcut?.resizePopover?.(430, base + extra, anchorBottom);
  }, [showResponseCard, textPanelOpen, effectiveState, isWorking, workingExpanded, clarificationQuestion, overlayCollapsed]);

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
        window.desktop?.shortcut?.resizePopover?.(430, 260, true);
        return;
      }

      if (isWorking) {
        const width = workingExpanded ? WORKING_EXPANDED_WIDTH : WORKING_NOTCH_WIDTH;
        const height = workingExpanded ? WORKING_EXPANDED_HEIGHT : WORKING_NOTCH_HEIGHT;
        window.desktop?.shortcut?.resizePopover?.(width, height, true);
        window.desktop?.shortcut?.repositionPopover?.("bottom-center");
        return;
      }

      const base = showResponseCard ? 300 : 130;
      const extra = textPanelOpen ? 110 : 0;
      // When the context panel is open, grow upward so the voice pill keeps
      // the same on-screen anchor position as other phases.
      window.desktop?.shortcut?.resizePopover?.(430, base + extra, textPanelOpen);
    });
    return () => unsub?.();
  }, [showResponseCard, textPanelOpen, effectiveState, isWorking, workingExpanded, clarificationQuestion, overlayCollapsed]);

  // Animate bars when speaking, go flat when idle
  useEffect(() => {
    if (overlayCollapsed) return;

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
  }, [effectiveState, overlayCollapsed]);

  const toggleRecording = useCallback(async () => {
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
  }, [isRecording, setError, startRecording, stopRecording]);

  const handleInterrupt = useCallback(() => {
    sendInterrupt();
    // Optimistic reset to avoid a stuck "Processing..." UI when interrupt
    // acknowledgement arrives late or misses a state transition event.
    const state = useSessionStore.getState();
    state.setTurnState("idle");
    state.setClarificationQuestion(null);
    setBarScales(FLAT_SCALE);
    setWorkingExpanded(false);
  }, [sendInterrupt]);

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
      className={`voice-popover-screen ${showCollapsedNotch ? "voice-popover-screen--notch" : ""} ${expandingFromNotch ? "voice-popover-screen--expanding" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) setTextPanelOpen(false); }}
    >
      <section className={`voice-popover-shell ${entered ? "voice-popover-shell--entered" : ""}`} aria-live="polite">
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
          <ClarificationCard
            question={clarificationQuestion}
            onSubmit={(answer) => {
              useSessionStore.getState().setClarificationQuestion(null);
              setTextPanelOpen(false);
              setContextText("");
              contextTextRef.current = "";
              sendTextInput(answer);
            }}
          />
        )}
        {!showCollapsedNotch && !clarificationQuestion && textPanelOpen && (
          <TextContextPanel
            value={contextText}
            onChange={setContextText}
          />
        )}
        {!showCollapsedNotch && <div className={`voice-pill-wrapper ${expandingFromNotch ? "voice-pill-wrapper--expand-in" : ""}`}>
          <button
            type="button"
            className={`voice-meter-pill ${isRecording ? "voice-meter-pill--recording" : ""} ${effectiveState === "speaking" ? "voice-meter-pill--speaking" : ""} ${(effectiveState === "thinking" || effectiveState === "acting") ? "voice-meter-pill--working" : ""} ${error ? "voice-meter-pill-error" : ""}`}
            disabled={!isRecording && micDisabled}
            onClick={() => { void toggleRecording(); }}
            title={error || (isRecording ? "Recording. Press Space to stop." : "Press Space to start.")}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          >
            {Array.from({ length: BAR_COUNT }, (_value, index) => (
              <span
                key={index}
                className="voice-meter-bar"
                style={{
                  height: `${Math.round((barScales[index] ?? 0.5) * 22)}px`,
                }}
              />
            ))}
          </button>
          {(effectiveState === "thinking" || effectiveState === "acting") && (
            <button
              type="button"
              className="voice-cancel-btn"
              onClick={handleInterrupt}
              title="Cancel task"
              aria-label="Cancel task"
            >
              ✕
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
              ˅
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
              ■
            </button>
          )}
          {!isWorking && <button
            type="button"
            className={`voice-cancel-btn voice-text-toggle-btn ${textPanelOpen ? "voice-text-toggle-btn--open" : ""}`}
            style={{ left: 14, right: "auto" }}
            onClick={() => setTextPanelOpen((v) => !v)}
            title={textPanelOpen ? "Hide text input" : "Add context via text"}
            aria-label={textPanelOpen ? "Hide text input" : "Add context via text"}
          >
            ›
          </button>}
        </div>}
        {!showCollapsedNotch && <p
          key={statusKey}
          className={`voice-popover-status ${error ? "voice-popover-status-error" : ""}`}
        >
          {statusMessage}
        </p>}
        {!showCollapsedNotch && showResponseCard && (
          <div className="voice-response-card">
            <div className="voice-response-scroll" ref={responseCardRef}>
              <MarkdownResponse text={narrationText} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
