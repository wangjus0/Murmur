import { useCallback, useEffect, useRef, useState } from "react";
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
              : "Press Space to start";

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
  }, [clarificationQuestion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll response card to bottom as narration text streams in
  useEffect(() => {
    if (responseCardRef.current) {
      responseCardRef.current.scrollTop = responseCardRef.current.scrollHeight;
    }
  }, [narrationText]);

  // Resize window when response card or text panel show/hide
  useEffect(() => {
    // Always update the ref so anchorBottom is correct on the first ready call.
    const anchorBottom = textPanelOpen !== prevTextPanelOpenRef.current;
    prevTextPanelOpenRef.current = textPanelOpen;
    if (!ipcReadyRef.current) return;
    const base = showResponseCard ? 300 : 130;
    const extra = textPanelOpen ? 110 : 0;
    // Anchor bottom (grow upward) only when the text panel itself toggled,
    // so the pill stays in place. Response card grows downward normally.
    window.desktop?.shortcut?.resizePopover?.(430, base + extra, anchorBottom);
  }, [showResponseCard, textPanelOpen]);

  // Re-apply the correct window size whenever the popover is toggled back on.
  // When the overlay is hidden and re-shown, the main process resets the window
  // to its base height (130px). Since showResponseCard/textPanelOpen haven't
  // changed, the resize effect above won't re-run — so we listen for the
  // "popover:did-show" event and re-send the correct size here.
  useEffect(() => {
    const unsub = window.desktop?.shortcut?.onPopoverDidShow?.(() => {
      if (!ipcReadyRef.current) return;
      const base = showResponseCard ? 300 : 130;
      const extra = textPanelOpen ? 110 : 0;
      window.desktop?.shortcut?.resizePopover?.(430, base + extra, false);
    });
    return () => unsub?.();
  }, [showResponseCard, textPanelOpen]);

  // Animate bars when speaking, go flat when idle
  useEffect(() => {
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

    if (effectiveState === "thinking" || effectiveState === "acting") {
      setWorkingElapsed(0);
      const startTime = Date.now();
      const elapsedId = setInterval(() => {
        setWorkingElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      if (ipcReadyRef.current) window.desktop?.shortcut?.repositionPopover?.("top-right");
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

    if (effectiveState === "idle" && !isRecordingRef.current) {
      if (ipcReadyRef.current) window.desktop?.shortcut?.repositionPopover?.("center");
      setBarScales(FLAT_SCALE);
    }
  }, [effectiveState]);

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

  const closePopover = useCallback(() => {
    // Reset session state so that when the popover re-opens the stale
    // effectiveState (e.g. "thinking", "acting") doesn't immediately
    // re-trigger repositionPopover("top-right") before snapPopoverToCenter
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
      className="voice-popover-screen"
      onClick={(e) => { if (e.target === e.currentTarget) setTextPanelOpen(false); }}
    >
      <section className={`voice-popover-shell ${entered ? "voice-popover-shell--entered" : ""}`} aria-live="polite">
        {clarificationQuestion && (
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
        {!clarificationQuestion && textPanelOpen && (
          <TextContextPanel
            value={contextText}
            onChange={setContextText}
          />
        )}
        <div className="voice-pill-wrapper">
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
                  height: `${Math.round((barScales[index] ?? 0.5) * 27)}px`,
                }}
              />
            ))}
          </button>
          {(effectiveState === "thinking" || effectiveState === "acting") && (
            <button
              type="button"
              className="voice-cancel-btn"
              onClick={sendInterrupt}
              title="Cancel task"
              aria-label="Cancel task"
            >
              ✕
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
          <button
            type="button"
            className={`voice-cancel-btn voice-text-toggle-btn ${textPanelOpen ? "voice-text-toggle-btn--open" : ""}`}
            style={{ left: 14, right: "auto" }}
            onClick={() => setTextPanelOpen((v) => !v)}
            title={textPanelOpen ? "Hide text input" : "Add context via text"}
            aria-label={textPanelOpen ? "Hide text input" : "Add context via text"}
          >
            ›
          </button>
        </div>
        <p
          key={statusKey}
          className={`voice-popover-status ${error ? "voice-popover-status-error" : ""}`}
        >
          {statusMessage}
        </p>
        {showResponseCard && (
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
