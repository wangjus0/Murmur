import { useEffect, useMemo, useState } from "react";
import { useSession } from "./hooks/useSession";
import { useAudioPlayer } from "./features/narration/useAudioPlayer";
import { ActionTimeline } from "./features/browser/ActionTimeline";
import { TranscriptPanel } from "./features/transcript/TranscriptPanel";
import { useAuth } from "./features/auth/AuthProvider";
import { getSupabaseClient } from "./lib/supabase";
import {
  createDefaultOnboardingData,
  createPayload,
  deriveCurrentStep,
  mergePersistedOnboardingData,
  type MicrophoneAccessStatus,
  type OnboardingFormData,
} from "./features/auth/onboardingSchema";
import { normalizeMicrophoneAccessStatus } from "./features/auth/microphonePermission";
import {
  BROWSER_USE_INTEGRATIONS,
  BROWSER_USE_TOTAL_INTEGRATIONS,
} from "./data/browserUseIntegrations";
import { INTEGRATION_CONNECTION_STATE_STORAGE_KEY } from "./lib/integration-auth";
import {
  getAuthModeLabel,
  getIntegrationAuthDescriptor,
  type IntegrationAuthDescriptor,
} from "./data/integrationAuthMatrix";
import { useSessionStore } from "./store/session";

type WorkspaceView = "home" | "integrations" | "settings";

const DEFAULT_SHORTCUT = "Cmd+Shift+Space";
const SHORTCUT_MODIFIER_KEYS = new Set(["Shift", "Control", "Meta", "Alt", "AltGraph"]);
const SHORTCUT_KEY_LABELS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
};

const MICROPHONE_STATUS_LABELS: Record<OnboardingFormData["permissions"]["microphoneAccess"], string> = {
  granted: "Granted",
  denied: "Denied",
  restricted: "Restricted",
  "not-determined": "Not requested",
  unknown: "Unknown",
  unsupported: "Unsupported",
};

function formatTurnStateLabel(turnState: string): string {
  if (turnState.length === 0) {
    return "Idle";
  }

  return turnState.charAt(0).toUpperCase() + turnState.slice(1);
}

function formatShortcutParts(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

type ShortcutInputEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

type IntegrationConnectionState = {
  oauthConnected: boolean;
  apiKeyValues: Record<string, string>;
  updatedAt: number;
};

function createEmptyIntegrationConnectionState(): IntegrationConnectionState {
  return {
    oauthConnected: false,
    apiKeyValues: {},
    updatedAt: Date.now(),
  };
}

function readStoredIntegrationConnectionState(): Record<string, IntegrationConnectionState> {
  try {
    const raw = localStorage.getItem(INTEGRATION_CONNECTION_STATE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<
      string,
      {
        oauthConnected?: unknown;
        apiKeyValues?: unknown;
        updatedAt?: unknown;
      }
    >;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const nextEntries: Array<[string, IntegrationConnectionState]> = [];
    for (const [integrationName, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const oauthConnected = entry.oauthConnected === true;
      const apiKeyValues =
        entry.apiKeyValues && typeof entry.apiKeyValues === "object"
          ? Object.fromEntries(
              Object.entries(entry.apiKeyValues as Record<string, unknown>).filter(
                ([fieldId, value]) => typeof fieldId === "string" && typeof value === "string",
              ) as Array<[string, string]>,
            )
          : {};
      const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now();

      nextEntries.push([
        integrationName,
        {
          oauthConnected,
          apiKeyValues,
          updatedAt,
        },
      ]);
    }

    return Object.fromEntries(nextEntries);
  } catch {
    return {};
  }
}

function writeStoredIntegrationConnectionState(
  state: Record<string, IntegrationConnectionState>,
): void {
  try {
    localStorage.setItem(INTEGRATION_CONNECTION_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // no-op in restricted runtimes
  }
}

function areRequiredApiKeyFieldsConnected(
  descriptor: IntegrationAuthDescriptor,
  connection: IntegrationConnectionState,
): boolean {
  const requiredFields = descriptor.apiKeyFields ?? [];
  if (requiredFields.length === 0) {
    return true;
  }

  return requiredFields.every((field) => {
    const value = connection.apiKeyValues[field.id];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function isIntegrationConnected(
  descriptor: IntegrationAuthDescriptor,
  connection: IntegrationConnectionState,
): boolean {
  if (descriptor.authMode === "oauth") {
    return connection.oauthConnected;
  }

  if (descriptor.authMode === "api_key") {
    return areRequiredApiKeyFieldsConnected(descriptor, connection);
  }

  return connection.oauthConnected && areRequiredApiKeyFieldsConnected(descriptor, connection);
}

function formatShortcutFromKeyDown(event: ShortcutInputEvent): string | null {
  const key = event.key;
  if (!key || key === "Dead" || SHORTCUT_MODIFIER_KEYS.has(key)) {
    return null;
  }

  const modifiers: string[] = [];
  if (event.metaKey) {
    modifiers.push("Cmd");
  }
  if (event.ctrlKey) {
    modifiers.push("Ctrl");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }

  let normalizedKey = SHORTCUT_KEY_LABELS[key] ?? key;
  if (normalizedKey.length === 1) {
    normalizedKey = normalizedKey.toUpperCase();
  } else if (!SHORTCUT_KEY_LABELS[key]) {
    normalizedKey = normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);
  }

  return [...modifiers, normalizedKey].join("+");
}

export function App() {
  const { user, signOut, authError, clearAuthError } = useAuth();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const audioPlayer = useAudioPlayer();
  useSession(audioPlayer);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("home");
  const [settingsData, setSettingsData] = useState<OnboardingFormData | null>(null);
  const [settingsStepIndex, setSettingsStepIndex] = useState(1);
  const [isLoadingSettingsData, setIsLoadingSettingsData] = useState(false);
  const [isSavingSettingsData, setIsSavingSettingsData] = useState(false);
  const [isCheckingMicrophonePermission, setIsCheckingMicrophonePermission] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsStatusMessage, setSettingsStatusMessage] = useState<string | null>(null);
  const [isCapturingSettingsShortcut, setIsCapturingSettingsShortcut] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [integrationCatalogQuery, setIntegrationCatalogQuery] = useState("");
  const [selectedIntegrationName, setSelectedIntegrationName] = useState<string>(
    BROWSER_USE_INTEGRATIONS[0] ?? "Gmail",
  );
  const [integrationConnections, setIntegrationConnections] = useState<
    Record<string, IntegrationConnectionState>
  >({});
  const [integrationCredentialDrafts, setIntegrationCredentialDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [integrationAuthError, setIntegrationAuthError] = useState<string | null>(null);
  const [integrationAuthStatusMessage, setIntegrationAuthStatusMessage] = useState<string | null>(null);
  const connected = useSessionStore((state) => state.connected);
  const sessionId = useSessionStore((state) => state.sessionId);
  const turnState = useSessionStore((state) => state.turnState);
  const transcriptPartial = useSessionStore((state) => state.transcriptPartial);
  const transcriptFinals = useSessionStore((state) => state.transcriptFinals);
  const intent = useSessionStore((state) => state.intent);
  const narrationText = useSessionStore((state) => state.narrationText);
  const actionStatuses = useSessionStore((state) => state.actionStatuses);
  const sessionError = useSessionStore((state) => state.error);
  const clarificationQuestion = useSessionStore((state) => state.clarificationQuestion);

  const shortcutParts = useMemo(
    () => formatShortcutParts(settingsData?.preferences.shortcutBehavior ?? DEFAULT_SHORTCUT),
    [settingsData?.preferences.shortcutBehavior],
  );
  const isNameDirty = settingsData
    ? displayNameDraft.trim() !== settingsData.account.displayName.trim()
    : false;
  const filteredIntegrationCatalog = useMemo(() => {
    const query = integrationCatalogQuery.trim().toLowerCase();
    const matching = query
      ? BROWSER_USE_INTEGRATIONS.filter((name) => name.toLowerCase().includes(query))
      : BROWSER_USE_INTEGRATIONS;

    return [...matching].sort((a, b) => a.localeCompare(b));
  }, [integrationCatalogQuery]);
  const selectedIntegrationDescriptor = useMemo(
    () => getIntegrationAuthDescriptor(selectedIntegrationName),
    [selectedIntegrationName],
  );
  const selectedIntegrationConnection = useMemo(() => {
    return (
      integrationConnections[selectedIntegrationName] ??
      createEmptyIntegrationConnectionState()
    );
  }, [integrationConnections, selectedIntegrationName]);
  const selectedIntegrationDraftValues = useMemo(() => {
    const existingDraft = integrationCredentialDrafts[selectedIntegrationName];
    if (existingDraft) {
      return existingDraft;
    }

    return selectedIntegrationConnection.apiKeyValues;
  }, [
    integrationCredentialDrafts,
    selectedIntegrationConnection.apiKeyValues,
    selectedIntegrationName,
  ]);
  const selectedIntegrationIsConnected = useMemo(
    () =>
      isIntegrationConnected(selectedIntegrationDescriptor, selectedIntegrationConnection),
    [selectedIntegrationConnection, selectedIntegrationDescriptor],
  );
  const sessionStateTone = sessionError
    ? "attention"
    : clarificationQuestion
      ? "clarify"
      : connected
        ? "ready"
        : "idle";
  const sessionStateLabel = sessionError
    ? "Needs attention"
    : clarificationQuestion
      ? "Awaiting clarification"
      : connected
        ? "Realtime linked"
        : "Desktop shell only";
  const latestActionStatus = actionStatuses[actionStatuses.length - 1] ?? null;
  const currentIntentLabel = intent
    ? intent.intent.replace(/_/g, " ")
    : "Awaiting request";
  const homeMetricCards = useMemo(
    () => [
      {
        label: "Connection",
        value: connected ? "Live" : "Offline",
        description: connected ? "WebSocket session is ready for events." : "Waiting for a session handshake.",
      },
      {
        label: "Turn state",
        value: formatTurnStateLabel(turnState),
        description: sessionId ? `Session ${sessionId.slice(0, 8)}` : "No active session id yet.",
      },
      {
        label: "Transcript",
        value: transcriptFinals.length > 0 ? `${transcriptFinals.length} lines` : transcriptPartial ? "Listening live" : "Empty",
        description: transcriptPartial
          ? "Partial speech is currently streaming into the desktop shell."
          : "Transcript history stays visible here after each turn.",
      },
      {
        label: "Intent",
        value: currentIntentLabel,
        description: intent?.query ?? "Intent routing will appear after Murmur processes speech.",
      },
    ],
    [connected, currentIntentLabel, intent?.query, sessionId, transcriptFinals.length, transcriptPartial, turnState],
  );
  const recentActionStatuses = useMemo(
    () => actionStatuses.slice(-3).reverse(),
    [actionStatuses],
  );
  const setupIntegrations = useMemo(
    () =>
      filteredIntegrationCatalog.filter((integrationName) => {
        const descriptor = getIntegrationAuthDescriptor(integrationName);
        const connection =
          integrationConnections[integrationName] ??
          createEmptyIntegrationConnectionState();
        return isIntegrationConnected(descriptor, connection);
      }),
    [filteredIntegrationCatalog, integrationConnections],
  );
  const needsSetupIntegrations = useMemo(
    () =>
      filteredIntegrationCatalog.filter((integrationName) => {
        const descriptor = getIntegrationAuthDescriptor(integrationName);
        const connection =
          integrationConnections[integrationName] ??
          createEmptyIntegrationConnectionState();
        return !isIntegrationConnected(descriptor, connection);
      }),
    [filteredIntegrationCatalog, integrationConnections],
  );

  const titlebarSubtitle =
    activeView === "home"
      ? "Session event stream"
      : activeView === "integrations"
        ? "Integration setup"
      : activeView === "settings"
        ? "Workspace settings"
        : "Voice assistant workspace";

  const handleSignOut = async () => {
    clearAuthError();
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  const persistSettingsData = async (nextData: OnboardingFormData) => {
    if (!user) {
      throw new Error("You must be signed in to update settings.");
    }

    setIsSavingSettingsData(true);
    const payload = createPayload(settingsStepIndex, nextData);
    const { error: upsertError } = await supabase.from("onboarding_responses").upsert(
      {
        user_id: user.id,
        responses: payload,
        completed: true,
      },
      { onConflict: "user_id" },
    );
    setIsSavingSettingsData(false);

    if (upsertError) {
      throw new Error(upsertError.message);
    }
  };

  const updateShortcutBehavior = async (shortcut: string) => {
    if (!settingsData) {
      return;
    }

    const nextData: OnboardingFormData = {
      ...settingsData,
      preferences: {
        ...settingsData.preferences,
        shortcutBehavior: shortcut,
      },
    };

    setSettingsData(nextData);
    if (shortcut.trim().length === 0) {
      return;
    }

    setSettingsError(null);
    try {
      await persistSettingsData(nextData);
      setSettingsStatusMessage("Keybind updated.");
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Failed to save keybind.");
    }
  };

  const saveDisplayName = async () => {
    if (!settingsData) {
      return;
    }

    const nextName = displayNameDraft.trim();
    if (nextName.length === 0) {
      setSettingsError("Name is required.");
      return;
    }

    const nextData: OnboardingFormData = {
      ...settingsData,
      account: {
        ...settingsData.account,
        displayName: nextName,
      },
    };

    setSettingsData(nextData);
    setSettingsError(null);
    setSettingsStatusMessage(null);

    try {
      await persistSettingsData(nextData);
      setSettingsStatusMessage("Name updated.");
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Failed to save name.");
    }
  };

  const checkMicrophoneStatus = async () => {
    if (!settingsData) {
      return;
    }

    setIsCheckingMicrophonePermission(true);
    setSettingsError(null);
    setSettingsStatusMessage(null);

    let nextStatus: MicrophoneAccessStatus = "not-determined";
    try {
      if (window.desktop?.permissions?.getMicrophoneAccessStatus) {
        const status = await window.desktop.permissions.getMicrophoneAccessStatus();
        nextStatus = normalizeMicrophoneAccessStatus(status);
      } else if (!navigator.mediaDevices?.getUserMedia) {
        nextStatus = "unsupported";
      }

      const nextData: OnboardingFormData = {
        ...settingsData,
        permissions: {
          ...settingsData.permissions,
          microphoneAccess: nextStatus,
        },
      };

      setSettingsData(nextData);
      await persistSettingsData(nextData);
      setSettingsStatusMessage("Microphone status refreshed.");
    } catch (statusError) {
      setSettingsError(statusError instanceof Error ? statusError.message : "Failed to check microphone status.");
    } finally {
      setIsCheckingMicrophonePermission(false);
    }
  };

  const requestMicrophoneAccess = async () => {
    if (!settingsData) {
      return;
    }

    setSettingsError(null);
    setSettingsStatusMessage(null);

    try {
      let nextStatus: MicrophoneAccessStatus;
      let nextMessage = "Microphone access granted.";

      if (window.desktop?.permissions?.requestMicrophoneAccess) {
        const granted = await window.desktop.permissions.requestMicrophoneAccess();
        nextStatus = granted ? "granted" : "denied";
        if (!granted) {
          nextMessage = "Microphone access denied. Open settings to enable.";
        }
      } else if (!navigator.mediaDevices?.getUserMedia) {
        nextStatus = "unsupported";
        nextMessage = "Microphone permission is not supported in this runtime.";
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        nextStatus = "granted";
      }

      const nextData: OnboardingFormData = {
        ...settingsData,
        permissions: {
          ...settingsData.permissions,
          microphoneAccess: nextStatus,
        },
      };

      setSettingsData(nextData);
      await persistSettingsData(nextData);
      setSettingsStatusMessage(nextMessage);
    } catch {
      setSettingsError("Microphone access was denied. You can retry or open system settings.");
    }
  };

  const openMicrophoneSettings = async () => {
    if (window.desktop?.permissions?.openMicrophoneSettings) {
      await window.desktop.permissions.openMicrophoneSettings();
      return;
    }

    setSettingsStatusMessage("Open your browser or system privacy settings to enable microphone access.");
  };

  const updateIntegrationConnectionState = (
    integrationName: string,
    updater: (previous: IntegrationConnectionState) => IntegrationConnectionState,
  ) => {
    setIntegrationConnections((previous) => {
      const previousConnection =
        previous[integrationName] ?? createEmptyIntegrationConnectionState();
      const nextConnection = updater(previousConnection);
      const nextState = {
        ...previous,
        [integrationName]: nextConnection,
      };
      writeStoredIntegrationConnectionState(nextState);
      return nextState;
    });
  };

  const openOAuthForSelectedIntegration = async () => {
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(null);
    const encodedName = encodeURIComponent(selectedIntegrationName);
    const integrationUrl = `https://cloud.browser-use.com/integrations?integration=${encodedName}`;

    if (window.desktop?.openExternalUrl) {
      await window.desktop.openExternalUrl(integrationUrl);
    } else {
      window.open(integrationUrl, "_blank", "noopener,noreferrer");
    }
  };

  const markSelectedIntegrationOAuthConnection = (connected: boolean) => {
    updateIntegrationConnectionState(selectedIntegrationName, (previous) => ({
      ...previous,
      oauthConnected: connected,
      updatedAt: Date.now(),
    }));
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(
      connected
        ? `${selectedIntegrationName} OAuth marked connected.`
        : `${selectedIntegrationName} OAuth marked disconnected.`,
    );
  };

  const updateSelectedIntegrationApiKeyDraft = (fieldId: string, value: string) => {
    setIntegrationCredentialDrafts((previous) => ({
      ...previous,
      [selectedIntegrationName]: {
        ...(previous[selectedIntegrationName] ?? selectedIntegrationConnection.apiKeyValues),
        [fieldId]: value,
      },
    }));
  };

  const saveSelectedIntegrationApiKeys = () => {
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(null);
    const requiredFields = selectedIntegrationDescriptor.apiKeyFields ?? [];
    const draftValues = selectedIntegrationDraftValues;

    for (const field of requiredFields) {
      const value = draftValues[field.id];
      if (!value || value.trim().length === 0) {
        setIntegrationAuthError(`${field.label} is required.`);
        return;
      }
    }

    updateIntegrationConnectionState(selectedIntegrationName, (previous) => ({
      ...previous,
      apiKeyValues: requiredFields.reduce<Record<string, string>>((accumulator, field) => {
        accumulator[field.id] = (draftValues[field.id] ?? "").trim();
        return accumulator;
      }, {}),
      updatedAt: Date.now(),
    }));
    setIntegrationAuthStatusMessage(`${selectedIntegrationName} API credentials saved.`);
  };

  const resetSelectedIntegrationConnection = () => {
    updateIntegrationConnectionState(selectedIntegrationName, () => ({
      oauthConnected: false,
      apiKeyValues: {},
      updatedAt: Date.now(),
    }));
    setIntegrationCredentialDrafts((previous) => ({
      ...previous,
      [selectedIntegrationName]: {},
    }));
    setIntegrationAuthError(null);
    setIntegrationAuthStatusMessage(`${selectedIntegrationName} connection reset.`);
  };

  useEffect(() => {
    setIntegrationConnections(readStoredIntegrationConnectionState());
  }, []);

  useEffect(() => {
    if (activeView !== "settings" || !user) {
      return;
    }

    let active = true;
    const loadSettingsData = async () => {
      setIsLoadingSettingsData(true);
      setSettingsError(null);
      setSettingsStatusMessage(null);

      const { data, error: selectError } = await supabase
        .from("onboarding_responses")
        .select("responses")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!active) {
        return;
      }

      if (selectError) {
        setSettingsError(selectError.message);
        setIsLoadingSettingsData(false);
        return;
      }

      const merged = mergePersistedOnboardingData(data?.responses ?? null);
      setSettingsData(merged);
      setDisplayNameDraft(merged.account.displayName);
      setSettingsStepIndex(deriveCurrentStep(data?.responses ?? null));
      setIsLoadingSettingsData(false);
    };

    void loadSettingsData();

    return () => {
      active = false;
    };
  }, [activeView, supabase, user]);

  useEffect(() => {
    if (activeView !== "settings" || !isCapturingSettingsShortcut) {
      return;
    }

    const handleShortcutKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setIsCapturingSettingsShortcut(false);
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "Backspace") {
        void updateShortcutBehavior("");
        setIsCapturingSettingsShortcut(false);
        return;
      }

      const shortcut = formatShortcutFromKeyDown(event);
      if (!shortcut) {
        return;
      }

      void updateShortcutBehavior(shortcut);
      setIsCapturingSettingsShortcut(false);
    };

    window.addEventListener("keydown", handleShortcutKeyDown);
    return () => {
      window.removeEventListener("keydown", handleShortcutKeyDown);
    };
  }, [activeView, isCapturingSettingsShortcut, settingsData]);

  return (
    <div className="screen app-screen">
      <div className="app-frame">
        <div className="app-window-drag-handle" aria-hidden="true" />
        <aside className="app-rail" aria-label="Primary navigation">
          <div className="rail-logo" aria-hidden="true">Murmur</div>
          <button
            className={`rail-item${activeView === "home" ? " rail-item-active" : ""}`}
            aria-label="Home"
            type="button"
            onClick={() => {
              setActiveView("home");
            }}
          >
            Home
          </button>
          <button
            className={`rail-item${activeView === "integrations" ? " rail-item-active" : ""}`}
            aria-label="Integrations"
            type="button"
            onClick={() => {
              setActiveView("integrations");
            }}
          >
            Integrations
          </button>
          <button
            className={`rail-item${activeView === "settings" ? " rail-item-active" : ""}`}
            aria-label="Settings"
            type="button"
            onClick={() => {
              setActiveView("settings");
            }}
          >
            Settings
          </button>
          <button
            className="rail-item rail-item-signout"
            aria-label="Sign out"
            type="button"
            onClick={() => {
              void handleSignOut();
            }}
            disabled={isSigningOut}
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
        </aside>

        <div className="app-workspace">
          <header className={`app-topbar${activeView === "home" ? " app-topbar-home" : ""}`}>
            <div className="app-title-group">
              <p className="app-titlebar-label">Murmur</p>
              <p className="app-titlebar-subtitle">{titlebarSubtitle}</p>
            </div>

            {activeView === "home" && (
              <div className="search-wrap" role="search">
                <span className="search-icon" aria-hidden="true">◦</span>
                <input
                  className="search-input"
                  type="search"
                  placeholder="Search timeline and session events"
                  aria-label="Search timeline and session events"
                />
              </div>
            )}

            {activeView !== "home" && <div className="app-topbar-fill" aria-hidden="true" />}

            <div className="topbar-actions">
              <span className={`workspace-status-pill workspace-status-pill-${sessionStateTone}`}>
                {sessionStateLabel}
              </span>
              {user?.email && <span className="app-topbar-identity">{user.email}</span>}
            </div>
          </header>

          {activeView === "home" && (
            <div className="app-dashboard app-dashboard-home">
              {authError && <div className="alert alert-danger">{authError}</div>}
              <section className="panel stack-panel hero-card app-hero-panel">
                <div className="app-hero-topline">
                  <p className="eyebrow">Desktop control</p>
                  <span className={`workspace-status-pill workspace-status-pill-${sessionStateTone}`}>
                    {sessionStateLabel}
                  </span>
                </div>

                <div className="app-hero-copy">
                  <h1 className="app-title">Keep Murmur present on the desktop, not piled onto the call.</h1>
                  <p className="subtitle">
                    The shell now handles setup, monitoring, and recovery while the voice pill stays focused on the live overlay.
                  </p>
                </div>

                <div className="hero-metric-grid">
                  {homeMetricCards.map((metric) => (
                    <article key={metric.label} className="hero-metric-card">
                      <span className="hero-metric-label">{metric.label}</span>
                      <strong className="hero-metric-value">{metric.value}</strong>
                      <p className="hero-metric-copy">{metric.description}</p>
                    </article>
                  ))}
                </div>

                <div className="hero-action-row">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => {
                      setActiveView("integrations");
                    }}
                  >
                    Open integrations
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setActiveView("settings");
                    }}
                  >
                    Review voice settings
                  </button>
                </div>
              </section>

              <ActionTimeline
                title="Timeline"
                emptyMessage="No events yet. Start a session to stream logs."
                className="timeline-panel-home"
              />

              <section className="panel stack-panel utility-card workspace-briefing-panel">
                <div className="workspace-section-head">
                  <h3 className="panel-heading">Live brief</h3>
                  <p className="status-note">Current session context without opening the overlay.</p>
                </div>

                <div className="workspace-briefing-list">
                  <article className="workspace-briefing-item">
                    <span className="workspace-briefing-label">Latest action</span>
                    <p>{latestActionStatus ?? "Waiting for the first action status from the server."}</p>
                  </article>
                  <article className="workspace-briefing-item">
                    <span className="workspace-briefing-label">Clarification</span>
                    <p>{clarificationQuestion ?? "No clarification requested right now."}</p>
                  </article>
                  <article className="workspace-briefing-item">
                    <span className="workspace-briefing-label">Errors</span>
                    <p>{sessionError ?? "No runtime errors reported in this session."}</p>
                  </article>
                </div>
              </section>

              <TranscriptPanel />

              <section className="panel stack-panel actions-panel workspace-actions-panel">
                <div className="workspace-section-head">
                  <h3 className="panel-heading">Quick setup</h3>
                  <p className="status-note">The desktop-only tasks operators reach for most.</p>
                </div>

                <div className="workspace-action-list">
                  <button
                    type="button"
                    className="workspace-action-card"
                    onClick={() => {
                      setActiveView("integrations");
                    }}
                  >
                    <span className="workspace-action-title">Connect integrations</span>
                    <span className="workspace-action-copy">
                      Open provider setup and credential entry for Browser Use integrations.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="workspace-action-card"
                    onClick={() => {
                      setActiveView("settings");
                    }}
                  >
                    <span className="workspace-action-title">Adjust voice settings</span>
                    <span className="workspace-action-copy">
                      Re-check microphone access and update the desktop keybind.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="workspace-action-card"
                    onClick={() => {
                      void handleSignOut();
                    }}
                    disabled={isSigningOut}
                  >
                    <span className="workspace-action-title">Sign out</span>
                    <span className="workspace-action-copy">
                      {isSigningOut ? "Ending the current desktop session." : "Leave the workspace and return to the auth screen."}
                    </span>
                  </button>
                </div>
              </section>

              <section className="panel stack-panel narration-panel workspace-response-panel">
                <div className="narration-header">
                  <h3 className="panel-heading">Response channel</h3>
                  {audioPlayer.isPlaying && <span className="badge badge-speaking">Speaking</span>}
                </div>
                {narrationText ? (
                  <p>{narrationText}</p>
                ) : (
                  <p className="timeline-empty">Narration text will appear here once Murmur speaks back.</p>
                )}
                {recentActionStatuses.length > 0 && (
                  <div className="workspace-response-tags" aria-label="Recent action statuses">
                    {recentActionStatuses.map((status) => (
                      <span key={status} className="workspace-response-tag">
                        {status}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeView === "integrations" && (
            <div className="app-dashboard app-dashboard-integrations">
              <section className="panel stack-panel integrations-panel">
                <div className="workspace-section-head integrations-hero-head">
                  <p className="eyebrow">Integrations</p>
                  <h3 className="panel-heading">Connect the services Murmur can route through Browser Use.</h3>
                  <p className="status-note">
                    Browse supported providers, review auth requirements, and keep setup state visible in one place.
                  </p>
                </div>

                <section className="integrations-catalog" aria-label="Supported integrations catalog">
                  <div className="integrations-catalog-header">
                    <h4 className="panel-heading">Supported integrations</h4>
                    <span className="integrations-catalog-meta">
                      Loaded {BROWSER_USE_INTEGRATIONS.length} of {BROWSER_USE_TOTAL_INTEGRATIONS}
                    </span>
                  </div>

                  <div className="field">
                    <span className="field-label">Search</span>
                    <input
                      type="search"
                      value={integrationCatalogQuery}
                      onChange={(event) => {
                        setIntegrationCatalogQuery(event.target.value);
                      }}
                      placeholder="Search supported integrations..."
                      aria-label="Search supported integrations"
                    />
                  </div>

                  <div className="integrations-auth-workspace">
                    <article className="integration-auth-card">
                      <div className="integration-auth-card-header">
                        <h5 className="integration-auth-card-title">{selectedIntegrationName}</h5>
                        <span
                          className={`integration-connection-state ${selectedIntegrationIsConnected ? "integration-connection-state-connected" : "integration-connection-state-disconnected"}`}
                        >
                          {selectedIntegrationIsConnected ? "Connected" : "Needs setup"}
                        </span>
                      </div>

                      <p className="status-note">
                        Auth mode: <strong>{getAuthModeLabel(selectedIntegrationDescriptor.authMode)}</strong>
                      </p>

                      {integrationAuthError && <div className="alert alert-danger">{integrationAuthError}</div>}
                      {integrationAuthStatusMessage && (
                        <div className="alert alert-info">{integrationAuthStatusMessage}</div>
                      )}

                      {(selectedIntegrationDescriptor.authMode === "oauth" ||
                        selectedIntegrationDescriptor.authMode === "oauth_and_api_key") && (
                        <div className="integrations-auth-section">
                          <p className="integration-auth-section-title">OAuth</p>
                          <p className="status-note">
                            Connect via {selectedIntegrationDescriptor.oauthProvider ?? selectedIntegrationName}.
                          </p>
                          <div className="integrations-actions">
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => {
                                void openOAuthForSelectedIntegration();
                              }}
                            >
                              Open OAuth
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => {
                                markSelectedIntegrationOAuthConnection(
                                  !selectedIntegrationConnection.oauthConnected,
                                );
                              }}
                            >
                              {selectedIntegrationConnection.oauthConnected
                                ? "Mark OAuth disconnected"
                                : "Mark OAuth connected"}
                            </button>
                            {selectedIntegrationDescriptor.authMode === "oauth" && (
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={resetSelectedIntegrationConnection}
                              >
                                Reset connection
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {(selectedIntegrationDescriptor.authMode === "api_key" ||
                        selectedIntegrationDescriptor.authMode === "oauth_and_api_key") && (
                        <div className="integrations-auth-section">
                          <p className="integration-auth-section-title">API credentials</p>
                          <div className="onboarding-fields">
                            {(selectedIntegrationDescriptor.apiKeyFields ?? []).map((field) => (
                              <label key={field.id} className="field">
                                <span className="field-label">{field.label}</span>
                                <input
                                  type={field.secret ? "password" : "text"}
                                  value={selectedIntegrationDraftValues[field.id] ?? ""}
                                  onChange={(event) => {
                                    updateSelectedIntegrationApiKeyDraft(
                                      field.id,
                                      event.target.value,
                                    );
                                  }}
                                  placeholder={field.placeholder}
                                />
                              </label>
                            ))}
                          </div>
                          <div className="integrations-actions">
                            <button
                              type="button"
                              className="button button-primary"
                              onClick={saveSelectedIntegrationApiKeys}
                            >
                              Save API credentials
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={resetSelectedIntegrationConnection}
                            >
                              Reset connection
                            </button>
                          </div>
                        </div>
                      )}
                    </article>

                    {filteredIntegrationCatalog.length === 0 ? (
                      <p className="timeline-empty">No integrations match your search.</p>
                    ) : (
                      <div className="integrations-catalog-cells">
                        <article className="integrations-catalog-cell" aria-label="Set up integrations">
                          <div className="integrations-catalog-cell-header">
                            <h5 className="integration-auth-card-title">Set up</h5>
                            <span className="integrations-catalog-meta">
                              {setupIntegrations.length}
                            </span>
                          </div>
                          <div className="integrations-catalog-cell-body">
                            {setupIntegrations.length === 0 ? (
                              <p className="timeline-empty">No integrations are set up yet.</p>
                            ) : (
                              <div className="integrations-catalog-grid">
                                {setupIntegrations.map((integrationName) => {
                                  const descriptor = getIntegrationAuthDescriptor(integrationName);
                                  const connection =
                                    integrationConnections[integrationName] ??
                                    createEmptyIntegrationConnectionState();
                                  const connected = isIntegrationConnected(descriptor, connection);

                                  return (
                                    <button
                                      key={integrationName}
                                      type="button"
                                      className={`integration-catalog-item ${integrationName === selectedIntegrationName ? "integration-catalog-item-selected" : ""}`}
                                      onClick={() => {
                                        setSelectedIntegrationName(integrationName);
                                        setIntegrationAuthError(null);
                                        setIntegrationAuthStatusMessage(null);
                                      }}
                                    >
                                      <span>{integrationName}</span>
                                      <span className="integration-catalog-item-meta">
                                        <span className="integration-catalog-mode">
                                          {getAuthModeLabel(descriptor.authMode)}
                                        </span>
                                        <span
                                          className={`integration-catalog-status ${connected ? "integration-catalog-status-connected" : ""}`}
                                        >
                                          {connected ? "Connected" : "Setup"}
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </article>

                        <article className="integrations-catalog-cell" aria-label="Integrations that need setup">
                          <div className="integrations-catalog-cell-header">
                            <h5 className="integration-auth-card-title">Needs setup</h5>
                            <span className="integrations-catalog-meta">
                              {needsSetupIntegrations.length}
                            </span>
                          </div>
                          <div className="integrations-catalog-cell-body">
                            {needsSetupIntegrations.length === 0 ? (
                              <p className="timeline-empty">All matching integrations are set up.</p>
                            ) : (
                              <div className="integrations-catalog-grid">
                                {needsSetupIntegrations.map((integrationName) => {
                                  const descriptor = getIntegrationAuthDescriptor(integrationName);
                                  const connection =
                                    integrationConnections[integrationName] ??
                                    createEmptyIntegrationConnectionState();
                                  const connected = isIntegrationConnected(descriptor, connection);

                                  return (
                                    <button
                                      key={integrationName}
                                      type="button"
                                      className={`integration-catalog-item ${integrationName === selectedIntegrationName ? "integration-catalog-item-selected" : ""}`}
                                      onClick={() => {
                                        setSelectedIntegrationName(integrationName);
                                        setIntegrationAuthError(null);
                                        setIntegrationAuthStatusMessage(null);
                                      }}
                                    >
                                      <span>{integrationName}</span>
                                      <span className="integration-catalog-item-meta">
                                        <span className="integration-catalog-mode">
                                          {getAuthModeLabel(descriptor.authMode)}
                                        </span>
                                        <span
                                          className={`integration-catalog-status ${connected ? "integration-catalog-status-connected" : ""}`}
                                        >
                                          {connected ? "Connected" : "Setup"}
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </article>
                      </div>
                    )}
                  </div>
                </section>
              </section>
            </div>
          )}

          {activeView === "settings" && (
            <div className="app-dashboard app-dashboard-settings">
              <section className="panel stack-panel settings-panel">
                <div className="workspace-section-head settings-hero-head">
                  <p className="eyebrow">Settings</p>
                  <h3 className="panel-heading">Keep profile and voice controls polished between sessions.</h3>
                  <p className="status-note">
                    This is the desktop maintenance surface for your name, microphone status, and overlay keybind.
                  </p>
                </div>

                {settingsError && <div className="alert alert-danger">{settingsError}</div>}
                {settingsStatusMessage && <div className="alert alert-info">{settingsStatusMessage}</div>}

                <div className="settings-step-list">
                  <article className="section-card settings-step-card">
                    <h4 className="settings-step-title">Profile</h4>
                    <div className="field settings-name-field">
                      <span className="field-label">Name</span>
                      <div className="settings-name-row">
                        <input
                          type="text"
                          value={displayNameDraft}
                          onChange={(event) => {
                            setDisplayNameDraft(event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") {
                              return;
                            }
                            event.preventDefault();
                            void saveDisplayName();
                          }}
                          placeholder="Your name"
                        />
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            void saveDisplayName();
                          }}
                          disabled={!isNameDirty || isSavingSettingsData}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </article>

                  <article className="section-card settings-step-card">
                    <h4 className="settings-step-title">Voice</h4>

                    <div className="permission-item permission-item-minimal voice-setup-microphone-block settings-microphone-block">
                      <div>
                        <p className="permission-item-title">Microphone access</p>
                        <p className="permission-status">
                          Status: {MICROPHONE_STATUS_LABELS[(settingsData ?? createDefaultOnboardingData()).permissions.microphoneAccess]}
                        </p>
                      </div>
                      <div className="permission-item-actions voice-setup-microphone-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => {
                            void requestMicrophoneAccess();
                          }}
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            void checkMicrophoneStatus();
                          }}
                          disabled={isCheckingMicrophonePermission}
                        >
                          {isCheckingMicrophonePermission ? "Checking..." : "Re-check"}
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            void openMicrophoneSettings();
                          }}
                        >
                          Settings
                        </button>
                      </div>
                    </div>

                    <div className="field settings-keybind-field">
                      <span className="field-label">Audio pill keybind</span>
                      <div className="shortcut-capture-row">
                        <button
                          type="button"
                          className={`button button-danger shortcut-record-button ${isCapturingSettingsShortcut ? "shortcut-record-button-active" : ""}`}
                          onClick={() => {
                            void updateShortcutBehavior("");
                            setIsCapturingSettingsShortcut((previous) => !previous);
                          }}
                          aria-pressed={isCapturingSettingsShortcut}
                          aria-label={isCapturingSettingsShortcut ? "Stop recording shortcut" : "Record shortcut"}
                        >
                          <span className="shortcut-record-symbol" aria-hidden="true">
                            {isCapturingSettingsShortcut ? "■" : "●"}
                          </span>
                        </button>
                        <div
                          className={`shortcut-keybind-display ${isCapturingSettingsShortcut ? "shortcut-keybind-display-active" : ""}`}
                          aria-label={isCapturingSettingsShortcut ? "Listening for keybind input" : "Current keybind display"}
                        >
                          {shortcutParts.length > 0 ? (
                            <span className="shortcut-keycaps">
                              {shortcutParts.map((part, index) => (
                                <span key={`${part}-${index}`} className="shortcut-keycap-group">
                                  {index > 0 && <span className="shortcut-keycap-plus">+</span>}
                                  <kbd className="shortcut-keycap">{part}</kbd>
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="shortcut-keybind-empty">
                              {isCapturingSettingsShortcut ? "Press keys..." : "No keybind set"}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="button button-secondary shortcut-reset-button"
                          onClick={() => {
                            setIsCapturingSettingsShortcut(false);
                            void updateShortcutBehavior(DEFAULT_SHORTCUT);
                          }}
                        >
                          Reset to default
                        </button>
                      </div>
                      <p className="field-hint">Press Record to update key combo.</p>
                    </div>
                  </article>
                </div>

                {(isLoadingSettingsData || isSavingSettingsData) && (
                  <p className="status-note">
                    {isLoadingSettingsData ? "Loading settings..." : "Saving changes..."}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
