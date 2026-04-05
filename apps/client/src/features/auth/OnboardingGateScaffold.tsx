import { useEffect, useMemo, useState } from "react";
import {
  hydrateBrowserUseApiKeyFromDesktop,
  normalizeBrowserProfileId,
  normalizeBrowserUseApiKey,
  persistBrowserProfileId,
  persistBrowserUseApiKey,
} from "../../lib/browser-profile";
import { resolveServerHttpOrigin } from "../../lib/server-origin";
import { getSupabaseClient } from "../../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  createDefaultOnboardingData,
  createPayload,
  deriveCurrentStep,
  mergePersistedOnboardingData,
  validateStep,
  type MicrophoneAccessStatus,
  type OnboardingFormData,
  type StepErrors,
  type StepKey,
} from "./onboardingSchema";
import { isMicrophoneAccessSatisfied, normalizeMicrophoneAccessStatus } from "./microphonePermission";

type OnboardingGateScaffoldProps = {
  onCompleted: () => void;
  initialLoadError?: string | null;
};

type OnboardingRow = {
  responses: unknown;
  completed: boolean;
};

type StepMeta = {
  key: StepKey;
  title: string;
  description: string;
};

const STEP_META: StepMeta[] = [
  {
    key: "account",
    title: "Your name",
    description: "Tell us what to call you.",
  },
  {
    key: "permissions",
    title: "Voice setup",
    description: "Allow microphone access and pick your audio pill keybind.",
  },
];

const PERMISSIONS_STEP_INDEX = STEP_META.findIndex((step) => step.key === "permissions");
const SAFE_PERMISSIONS_STEP_INDEX = PERMISSIONS_STEP_INDEX >= 0 ? PERMISSIONS_STEP_INDEX : 0;

const INITIAL_STEP_ERRORS: Record<StepKey, StepErrors> = {
  permissions: {},
  account: {},
  workflow: {},
  preferences: {},
};

const LAST_STEP_INDEX = STEP_META.length - 1;
const BROWSER_PROFILE_SYNC_GUIDE_URL =
  "https://docs.browser-use.com/cloud/guides/profile-sync";
const BROWSER_USE_SETTINGS_URL = "https://cloud.browser-use.com/settings";
const BROWSER_PROFILE_SYNC_COMMAND =
  "export BROWSER_USE_API_KEY=your_key && curl -fsSL https://browser-use.com/profile.sh | sh";

function InlineError({ message, id }: { message?: string; id: string }) {
  if (!message) {
    return null;
  }

  return <p id={id} className="field-error">{message}</p>;
}

const MICROPHONE_STATUS_LABEL: Record<MicrophoneAccessStatus, string> = {
  granted: "Granted",
  denied: "Denied",
  restricted: "Restricted",
  "not-determined": "Not requested",
  unsupported: "Unsupported",
  unknown: "Unknown",
};

function AccountStep(props: {
  data: OnboardingFormData["account"];
  errors: StepErrors;
  onDisplayNameChange: (value: string) => void;
}) {
  return (
    <div className="onboarding-fields">
      <label className="field">
        <span className="field-label">Name</span>
        <input
          type="text"
          value={props.data.displayName}
          onChange={(event) => props.onDisplayNameChange(event.target.value)}
          placeholder="Alex Rivera"
          aria-invalid={Boolean(props.errors.displayName)}
          aria-describedby={props.errors.displayName ? "display-name-error" : undefined}
        />
        <InlineError id="display-name-error" message={props.errors.displayName} />
      </label>
    </div>
  );
}

const SHORTCUT_MODIFIER_KEYS = new Set(["Shift", "Control", "Meta", "Alt", "AltGraph"]);

const SHORTCUT_KEY_LABELS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Esc",
};
const DEFAULT_SHORTCUT = "Cmd+Shift+Space";

type ShortcutInputEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

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

function AudioSetupStep(props: {
  permissions: OnboardingFormData["permissions"];
  shortcutBehavior: string;
  permissionErrors: StepErrors;
  preferenceErrors: StepErrors;
  checkingStatus: boolean;
  onRequestMicrophoneAccess: () => Promise<void>;
  onCheckMicrophoneStatus: () => Promise<void>;
  onOpenMicrophoneSettings: () => Promise<void>;
  browserUseApiKey: string;
  onBrowserUseApiKeyChange: (value: string) => void;
  onStartAutomaticBrowserProfileSync: () => Promise<void>;
  runningAutomaticSync: boolean;
  onBrowserProfileIdChange: (value: string) => void;
  onOpenBrowserUseSettings: () => Promise<void>;
  onCopyBrowserProfileSyncCommand: () => Promise<void>;
  onOpenBrowserProfileSyncGuide: () => Promise<void>;
  onValidateBrowserProfileId: () => Promise<void>;
  checkingBrowserProfile: boolean;
  browserProfileConnected: boolean;
  onShortcutBehaviorChange: (value: string) => void;
}) {
  const [isCapturingShortcut, setIsCapturingShortcut] = useState(false);

  const shortcutDescribedBy = [
    "shortcut-behavior-hint",
    props.preferenceErrors.shortcutBehavior ? "shortcut-behavior-error" : null,
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!isCapturingShortcut) {
      return;
    }

    const handleShortcutKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setIsCapturingShortcut(false);
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "Backspace") {
        props.onShortcutBehaviorChange("");
        setIsCapturingShortcut(false);
        return;
      }

      const shortcut = formatShortcutFromKeyDown(event);
      if (!shortcut) {
        return;
      }

      props.onShortcutBehaviorChange(shortcut);
      setIsCapturingShortcut(false);
    };

    window.addEventListener("keydown", handleShortcutKeyDown);
    return () => {
      window.removeEventListener("keydown", handleShortcutKeyDown);
    };
  }, [isCapturingShortcut, props.onShortcutBehaviorChange]);

  const handleRecordButtonClick = () => {
    props.onShortcutBehaviorChange("");
    setIsCapturingShortcut((previous) => !previous);
  };

  const shortcutParts = props.shortcutBehavior
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <div className="onboarding-fields">
      <div className="permission-item permission-item-minimal voice-setup-microphone-block">
        <div>
          <h3 className="permission-item-title">Microphone access</h3>
          <p className="permission-status">Status: {MICROPHONE_STATUS_LABEL[props.permissions.microphoneAccess]}</p>
          <InlineError id="microphone-access-error" message={props.permissionErrors.microphoneAccess} />
        </div>
        <div className="permission-item-actions voice-setup-microphone-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              void props.onRequestMicrophoneAccess();
            }}
          >
            Allow
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void props.onCheckMicrophoneStatus();
            }}
            disabled={props.checkingStatus}
          >
            {props.checkingStatus ? "Checking..." : "Re-check"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void props.onOpenMicrophoneSettings();
            }}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Audio pill keybind</span>
        <div className="shortcut-capture-row">
          <button
            type="button"
            className={`button button-danger shortcut-record-button ${isCapturingShortcut ? "shortcut-record-button-active" : ""}`}
            onClick={handleRecordButtonClick}
            aria-pressed={isCapturingShortcut}
            aria-label={isCapturingShortcut ? "Stop recording shortcut" : "Record shortcut"}
            title={isCapturingShortcut ? "Stop recording shortcut" : "Record shortcut"}
          >
            <span className="shortcut-record-symbol" aria-hidden="true">{isCapturingShortcut ? "■" : "●"}</span>
          </button>
          <div
            className={`shortcut-keybind-display ${isCapturingShortcut ? "shortcut-keybind-display-active" : ""}`}
            aria-invalid={Boolean(props.preferenceErrors.shortcutBehavior)}
            aria-describedby={shortcutDescribedBy}
            aria-label={isCapturingShortcut ? "Listening for keybind input" : "Current keybind display"}
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
                {isCapturingShortcut ? "Press keys..." : "No keybind set"}
              </span>
            )}
          </div>
          <button
            type="button"
            className="button button-secondary shortcut-reset-button"
            onClick={() => {
              props.onShortcutBehaviorChange(DEFAULT_SHORTCUT);
              setIsCapturingShortcut(false);
            }}
          >
            Reset to default
          </button>
        </div>
        <p id="shortcut-behavior-hint" className="field-hint">
          Press Record to update key combo.
        </p>
        <InlineError id="shortcut-behavior-error" message={props.preferenceErrors.shortcutBehavior} />
      </div>

    </div>
  );
}

export function OnboardingGateScaffold({ onCompleted, initialLoadError }: OnboardingGateScaffoldProps) {
  const { user, signOut } = useAuth();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [isInitializing, setIsInitializing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<OnboardingFormData>(createDefaultOnboardingData());
  const [stepErrors, setStepErrors] = useState<Record<StepKey, StepErrors>>(INITIAL_STEP_ERRORS);
  const [saveError, setSaveError] = useState<string | null>(initialLoadError ?? null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isCheckingPermission, setIsCheckingPermission] = useState(false);
  const [isCheckingBrowserProfile, setIsCheckingBrowserProfile] = useState(false);
  const [browserUseApiKey, setBrowserUseApiKey] = useState("");
  const [isRunningAutomaticSync, setIsRunningAutomaticSync] = useState(false);

  const activeStep = STEP_META[currentStep];

  const setMicrophoneAccess = (value: MicrophoneAccessStatus) => {
    setFormData((previous) => ({
      ...previous,
      permissions: {
        ...previous.permissions,
        microphoneAccess: value,
      },
    }));

    setStepErrors((previous) => {
      const { microphoneAccess: _removed, ...remaining } = previous.permissions;
      return {
        ...previous,
        permissions: remaining,
      };
    });
  };

  const checkMicrophoneStatus = async () => {
    setIsCheckingPermission(true);
    try {
      if (window.desktop?.permissions?.getMicrophoneAccessStatus) {
        const status = await window.desktop.permissions.getMicrophoneAccessStatus();
        setMicrophoneAccess(normalizeMicrophoneAccessStatus(status));
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneAccess("unsupported");
        return;
      }

      setMicrophoneAccess("not-determined");
    } finally {
      setIsCheckingPermission(false);
    }
  };

  const requestMicrophoneAccess = async () => {
    setSaveError(null);
    setStatusMessage(null);

    try {
      if (window.desktop?.permissions?.requestMicrophoneAccess) {
        const granted = await window.desktop.permissions.requestMicrophoneAccess();
        setMicrophoneAccess(granted ? "granted" : "denied");
        setStatusMessage(granted ? "Microphone access granted." : "Microphone access denied. Open settings to enable.");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophoneAccess("unsupported");
        setStatusMessage("Microphone permission is not supported in this runtime.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      setMicrophoneAccess("granted");
      setStatusMessage("Microphone access granted.");
    } catch {
      setMicrophoneAccess("denied");
      setSaveError("Microphone access was denied. You can retry or open system settings.");
    }
  };

  const openMicrophoneSettings = async () => {
    if (window.desktop?.permissions?.openMicrophoneSettings) {
      await window.desktop.permissions.openMicrophoneSettings();
      return;
    }

    setStatusMessage("Open your browser or system privacy settings to enable microphone access.");
  };

  const openBrowserProfileSyncGuide = async () => {
    const externalUrlApi = window.desktop?.openExternalUrl;
    if (externalUrlApi) {
      await externalUrlApi(BROWSER_PROFILE_SYNC_GUIDE_URL);
      return;
    }

    window.open(BROWSER_PROFILE_SYNC_GUIDE_URL, "_blank", "noopener,noreferrer");
  };

  const openBrowserUseSettings = async () => {
    const externalUrlApi = window.desktop?.openExternalUrl;
    if (externalUrlApi) {
      await externalUrlApi(BROWSER_USE_SETTINGS_URL);
      return;
    }

    window.open(BROWSER_USE_SETTINGS_URL, "_blank", "noopener,noreferrer");
  };

  const copyBrowserProfileSyncCommand = async () => {
    setSaveError(null);

    if (!navigator.clipboard?.writeText) {
      setStatusMessage("Clipboard is unavailable. Copy the command from the tutorial section.");
      return;
    }

    try {
      await navigator.clipboard.writeText(BROWSER_PROFILE_SYNC_COMMAND);
      setStatusMessage("Browser profile sync command copied.");
    } catch {
      setSaveError("Could not copy sync command. Copy it manually from the tutorial section.");
    }
  };

  const validateBrowserProfileId = async () => {
    setSaveError(null);
    setStatusMessage(null);
    setIsCheckingBrowserProfile(true);

    try {
      const candidate = normalizeBrowserProfileId(formData.permissions.browserProfileId);
      if (!candidate) {
        setStepErrors((previous) => ({
          ...previous,
          permissions: {
            ...previous.permissions,
            browserProfileId: "Enter a valid Browser Use profile ID (UUID).",
          },
        }));
        return;
      }

      const serverOrigin = resolveServerHttpOrigin(
        window.location,
        window.desktop?.getRealtimeWebSocketUrl?.()
      );
      const response = await fetch(
        `${serverOrigin}/integrations/browser-use/profiles/${encodeURIComponent(candidate)}/validate`,
        {
          headers: browserUseApiKey
            ? {
                "x-murmur-browser-use-api-key": browserUseApiKey,
              }
            : undefined,
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        valid?: boolean;
        message?: string;
        profileId?: string;
      };
      if (!response.ok || payload.valid !== true) {
        setSaveError(payload.message || "Could not verify Browser Use profile ID.");
        return;
      }

      const normalized = normalizeBrowserProfileId(payload.profileId) ?? candidate;
      updateStepField("permissions", "browserProfileId", normalized);
      await persistBrowserProfileId(normalized);
      setStatusMessage("Browser profile connected.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to verify Browser Use profile ID.");
    } finally {
      setIsCheckingBrowserProfile(false);
    }
  };

  const startAutomaticBrowserProfileSync = async () => {
    setSaveError(null);
    setStatusMessage(null);

    const normalizedApiKey = normalizeBrowserUseApiKey(browserUseApiKey);
    if (!normalizedApiKey) {
      setSaveError("Enter a valid Browser Use API key (starts with bu_).");
      return;
    }

    const syncApi = window.desktop?.browserUse?.startProfileSync;
    if (!syncApi) {
      setSaveError("Automatic sync is only available in the desktop app. Use the guide to sync manually.");
      return;
    }

    setIsRunningAutomaticSync(true);
    try {
      await persistBrowserUseApiKey(normalizedApiKey);
      const result = await syncApi(normalizedApiKey);
      if (!result.success) {
        setSaveError(result.message);
        return;
      }

      if (result.profileId) {
        updateStepField("permissions", "browserProfileId", result.profileId);
        await persistBrowserProfileId(result.profileId);
        setStatusMessage("Browser profile synced and connected.");
        return;
      }

      setStatusMessage("Sync completed. Paste the generated profile ID and click Verify profile.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Automatic profile sync failed.");
    } finally {
      setIsRunningAutomaticSync(false);
    }
  };

  useEffect(() => {
    let isActive = true;

    const hydrate = async () => {
      if (!user) {
        if (isActive) {
          setIsInitializing(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("onboarding_responses")
        .select("responses, completed")
        .eq("user_id", user.id)
        .maybeSingle<OnboardingRow>();

      if (!isActive) {
        return;
      }

      if (error) {
        setSaveError(error.message);
        setIsInitializing(false);
        return;
      }

      if (data?.completed) {
        onCompleted();
        return;
      }

      if (data?.responses) {
        setFormData(mergePersistedOnboardingData(data.responses));
        setCurrentStep(deriveCurrentStep(data.responses));
      }

      setIsInitializing(false);
    };

    void hydrate();
    void hydrateBrowserUseApiKeyFromDesktop().then((apiKey) => {
      if (!apiKey) {
        return;
      }

      setBrowserUseApiKey(apiKey);
    });

    return () => {
      isActive = false;
    };
  }, [onCompleted, supabase, user]);

  useEffect(() => {
    if (currentStep !== SAFE_PERMISSIONS_STEP_INDEX) {
      return;
    }

    if (formData.permissions.microphoneAccess === "granted") {
      return;
    }

    void checkMicrophoneStatus();
  }, [currentStep]);

  const browserProfileConnected = Boolean(
    normalizeBrowserProfileId(formData.permissions.browserProfileId)
  );
  const persistProgress = async (options: { completed: boolean; completedAt: string | null; nextStep: number }) => {
    if (!user) {
      throw new Error("You must be signed in to save onboarding.");
    }

    const payload = createPayload(options.nextStep, formData);

    const { error } = await supabase.from("onboarding_responses").upsert(
      {
        user_id: user.id,
        responses: payload,
        completed: options.completed,
        completed_at: options.completedAt,
      },
      {
        onConflict: "user_id",
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    await persistBrowserProfileId(
      normalizeBrowserProfileId(formData.permissions.browserProfileId)
    );
  };

  const applyValidationForCurrentStep = (): boolean => {
    if (activeStep.key === "permissions") {
      const permissionValidation = validateStep("permissions", formData);
      const preferenceValidation = validateStep("preferences", formData);
      const preferenceErrors: StepErrors = {};

      if (preferenceValidation.shortcutBehavior) {
        preferenceErrors.shortcutBehavior = preferenceValidation.shortcutBehavior;
      }

      setStepErrors((previous) => ({
        ...previous,
        permissions: permissionValidation,
        preferences: preferenceErrors,
      }));

      return Object.keys(permissionValidation).length === 0 && Object.keys(preferenceErrors).length === 0;
    }

    const validation = validateStep(activeStep.key, formData);
    setStepErrors((previous) => ({
      ...previous,
      [activeStep.key]: validation,
    }));

    return Object.keys(validation).length === 0;
  };

  const handleNext = async () => {
    if (!applyValidationForCurrentStep()) {
      return;
    }

    const nextStep = Math.min(currentStep + 1, LAST_STEP_INDEX);
    setSaveError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      await persistProgress({ completed: false, completedAt: null, nextStep });
      setCurrentStep(nextStep);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save progress.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    setSaveError(null);
    setStatusMessage(null);
    setCurrentStep((previous) => Math.max(0, previous - 1));
  };

  const updateStepField = <TStep extends StepKey, TField extends keyof OnboardingFormData[TStep]>(
    step: TStep,
    field: TField,
    value: string,
  ) => {
    setFormData((previous) => ({
      ...previous,
      [step]: {
        ...previous[step],
        [field]: value,
      },
    }));

    setStepErrors((previous) => {
      const currentStepErrors = previous[step];
      const { [field as string]: _removed, ...remainingStepErrors } = currentStepErrors;

      return {
        ...previous,
        [step]: remainingStepErrors,
      };
    });
  };

  const handleComplete = async () => {
    if (!applyValidationForCurrentStep()) {
      return;
    }

    if (!isMicrophoneAccessSatisfied(formData.permissions.microphoneAccess)) {
      setCurrentStep(SAFE_PERMISSIONS_STEP_INDEX);
      setSaveError("Please enable microphone access before completing onboarding.");
      return;
    }

    setSaveError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      const completedAt = new Date().toISOString();
      await persistProgress({ completed: true, completedAt, nextStep: LAST_STEP_INDEX });
      onCompleted();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to complete onboarding.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="screen">
        <div className="panel status-card center-status">Loading onboarding...</div>
      </div>
    );
  }

  return (
    <div className="screen onboarding-screen">
      <div className="onboarding-shell onboarding-shell-minimal">
        <div className="panel onboarding-card onboarding-main">
          <header className="onboarding-header onboarding-header-minimal">
            <p className="eyebrow">Quick setup</p>
            <h1 className="onboarding-title">Set up Murmur</h1>
            <p className="onboarding-step-progress">Step {currentStep + 1} of {STEP_META.length}</p>
          </header>

          <section className="section-card onboarding-form-card">
            <div>
              <h2 className="onboarding-step-title">{activeStep.title}</h2>
              <p>{activeStep.description}</p>
            </div>

            {activeStep.key === "account" && (
              <AccountStep
                data={formData.account}
                errors={stepErrors.account}
                onDisplayNameChange={(value) => {
                  updateStepField("account", "displayName", value);
                }}
              />
            )}

            {activeStep.key === "permissions" && (
              <AudioSetupStep
                permissions={formData.permissions}
                shortcutBehavior={formData.preferences.shortcutBehavior}
                permissionErrors={stepErrors.permissions}
                preferenceErrors={stepErrors.preferences}
                checkingStatus={isCheckingPermission}
                onRequestMicrophoneAccess={requestMicrophoneAccess}
                onCheckMicrophoneStatus={checkMicrophoneStatus}
                onOpenMicrophoneSettings={openMicrophoneSettings}
                onShortcutBehaviorChange={(value) => {
                  updateStepField("preferences", "shortcutBehavior", value);
                }}
                browserUseApiKey={browserUseApiKey}
                onBrowserUseApiKeyChange={(value) => {
                  setBrowserUseApiKey(value);
                }}
                onStartAutomaticBrowserProfileSync={startAutomaticBrowserProfileSync}
                runningAutomaticSync={isRunningAutomaticSync}
                onBrowserProfileIdChange={(value) => {
                  updateStepField("permissions", "browserProfileId", value);
                }}
                onOpenBrowserUseSettings={openBrowserUseSettings}
                onCopyBrowserProfileSyncCommand={copyBrowserProfileSyncCommand}
                onOpenBrowserProfileSyncGuide={openBrowserProfileSyncGuide}
                onValidateBrowserProfileId={validateBrowserProfileId}
                checkingBrowserProfile={isCheckingBrowserProfile}
                browserProfileConnected={browserProfileConnected}
              />
            )}
          </section>

          {statusMessage && <p className="alert alert-info">{statusMessage}</p>}
          {saveError && <p className="alert alert-danger">{saveError}</p>}

          <footer className="footer-actions footer-actions-minimal">
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              disabled={isSaving}
              className="button button-secondary"
            >
              Sign out
            </button>

            <div className="action-group">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0 || isSaving}
                className="button button-secondary"
              >
                Back
              </button>

              {currentStep < LAST_STEP_INDEX ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleNext();
                  }}
                  disabled={isSaving}
                  className="button button-primary"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleComplete();
                  }}
                  disabled={isSaving}
                  className="button button-primary"
                >
                  Finish
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
