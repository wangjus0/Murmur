import { create } from "zustand";
import type { TurnState, IntentResult } from "@murmur/shared";

export type ActionTimelineKind =
  | "session"
  | "state"
  | "action"
  | "intent"
  | "narration"
  | "done"
  | "error";

export interface ActionTimelineItem {
  id: string;
  kind: ActionTimelineKind;
  message: string;
  createdAt: number;
}

export interface BrowserViewState {
  sessionId: string;
  status: string;
  liveUrl: string | null;
  screenshotUrl: string | null;
  stepCount: number | null;
  lastStepSummary: string | null;
  isTaskSuccessful: boolean | null;
  updatedAt: number;
}

export type BrowserViewStoreUpdate = Omit<BrowserViewState, "updatedAt">;

export interface SessionState {
  connected: boolean;
  sessionId: string | null;
  turnState: TurnState;
  transcriptPartial: string;
  transcriptFinals: string[];
  actionTimeline: ActionTimelineItem[];
  intent: IntentResult | null;
  narrationText: string;
  actionStatuses: string[];
  error: string | null;
  clarificationQuestion: string | null;
  browserView: BrowserViewState | null;

  // Actions
  setConnected: (connected: boolean) => void;
  setSessionId: (sessionId: string | null) => void;
  setTurnState: (turnState: TurnState) => void;
  setTranscriptPartial: (text: string) => void;
  addTranscriptFinal: (text: string) => void;
  addActionTimelineItem: (entry: Omit<ActionTimelineItem, "id" | "createdAt">) => void;
  clearActionTimeline: () => void;
  setIntent: (intent: IntentResult | null) => void;
  setNarrationText: (text: string) => void;
  addActionStatus: (message: string) => void;
  clearActionStatuses: () => void;
  setError: (error: string | null) => void;
  setClarificationQuestion: (question: string | null) => void;
  setBrowserView: (view: BrowserViewStoreUpdate) => void;
  clearBrowserView: () => void;
  reset: () => void;
}

const initialState = {
  connected: false,
  sessionId: null,
  turnState: "idle" as TurnState,
  transcriptPartial: "",
  transcriptFinals: [] as string[],
  actionTimeline: [] as ActionTimelineItem[],
  intent: null,
  narrationText: "",
  actionStatuses: [] as string[],
  error: null,
  clarificationQuestion: null as string | null,
  browserView: null as BrowserViewState | null,
};

const TIMELINE_MAX_ITEMS = 200;

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setConnected: (connected) => set({ connected }),
  setSessionId: (sessionId) => set({ sessionId }),
  setTurnState: (turnState) => set({ turnState }),
  setTranscriptPartial: (text) => set({ transcriptPartial: text }),
  addTranscriptFinal: (text) =>
    set((s) => ({ transcriptFinals: [...s.transcriptFinals, text] })),
  addActionTimelineItem: (entry) =>
    set((s) => {
      const nextTimeline = [
        ...s.actionTimeline,
        {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          ...entry,
        },
      ];

      return {
        actionTimeline: nextTimeline.slice(-TIMELINE_MAX_ITEMS),
      };
    }),
  clearActionTimeline: () => set({ actionTimeline: [] }),
  setIntent: (intent) => set({ intent }),
  setNarrationText: (text) => set({ narrationText: text }),
  addActionStatus: (message) =>
    set((s) => ({ actionStatuses: [...s.actionStatuses, message] })),
  clearActionStatuses: () => set({ actionStatuses: [] }),
  setError: (error) => set({ error }),
  setClarificationQuestion: (question) => set({ clarificationQuestion: question }),
  setBrowserView: (view) =>
    set((s) => {
      const previous = s.browserView?.sessionId === view.sessionId ? s.browserView : null;
      return {
        browserView: {
          ...view,
          liveUrl: view.liveUrl ?? previous?.liveUrl ?? null,
          screenshotUrl: view.screenshotUrl ?? previous?.screenshotUrl ?? null,
          stepCount: view.stepCount ?? previous?.stepCount ?? null,
          lastStepSummary: view.lastStepSummary ?? previous?.lastStepSummary ?? null,
          isTaskSuccessful: view.isTaskSuccessful ?? previous?.isTaskSuccessful ?? null,
          updatedAt: Date.now(),
        },
      };
    }),
  clearBrowserView: () => set({ browserView: null }),
  reset: () => set(initialState),
}));
