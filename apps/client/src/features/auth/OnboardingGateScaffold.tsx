import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  createDefaultOnboardingData,
  createPayload,
  deriveCurrentStep,
  mergePersistedOnboardingData,
  validateStep,
  type OnboardingFormData,
  type StepErrors,
  type StepKey,
} from "./onboardingSchema";

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
    title: "Account basics",
    description: "Placeholder fields for profile and workspace metadata.",
  },
  {
    key: "workflow",
    title: "Workflow snapshot",
    description: "Placeholder prompts for use cases and primary outcomes.",
  },
  {
    key: "preferences",
    title: "Command preferences",
    description: "Placeholder settings for shortcut and assistant behavior.",
  },
];

const INITIAL_STEP_ERRORS: Record<StepKey, StepErrors> = {
  account: {},
  workflow: {},
  preferences: {},
};

const LAST_STEP_INDEX = STEP_META.length - 1;

function InlineError({ message, id }: { message?: string; id: string }) {
  if (!message) {
    return null;
  }

  return <p id={id} className="field-error">{message}</p>;
}

function AccountStep(props: {
  data: OnboardingFormData["account"];
  errors: StepErrors;
  onDisplayNameChange: (value: string) => void;
  onWorkspaceNameChange: (value: string) => void;
}) {
  return (
    <div className="onboarding-fields">
      <label className="field">
        <span className="field-label">Display name (placeholder)</span>
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

      <label className="field">
        <span className="field-label">Workspace name (placeholder)</span>
        <input
          type="text"
          value={props.data.workspaceName}
          onChange={(event) => props.onWorkspaceNameChange(event.target.value)}
          placeholder="Murmur Team"
          aria-invalid={Boolean(props.errors.workspaceName)}
          aria-describedby={props.errors.workspaceName ? "workspace-name-error" : undefined}
        />
        <InlineError id="workspace-name-error" message={props.errors.workspaceName} />
      </label>
    </div>
  );
}

function WorkflowStep(props: {
  data: OnboardingFormData["workflow"];
  errors: StepErrors;
  onPrimaryGoalChange: (value: string) => void;
  onUseCasesChange: (value: string) => void;
}) {
  return (
    <div className="onboarding-fields">
      <label className="field">
        <span className="field-label">Primary goal (placeholder)</span>
        <textarea
          value={props.data.primaryGoal}
          onChange={(event) => props.onPrimaryGoalChange(event.target.value)}
          rows={3}
          placeholder="What should Murmur help you accomplish first?"
          className="resizable-textarea"
          aria-invalid={Boolean(props.errors.primaryGoal)}
          aria-describedby={props.errors.primaryGoal ? "primary-goal-error" : undefined}
        />
        <InlineError id="primary-goal-error" message={props.errors.primaryGoal} />
      </label>

      <label className="field">
        <span className="field-label">Frequent use cases (placeholder)</span>
        <textarea
          value={props.data.useCases}
          onChange={(event) => props.onUseCasesChange(event.target.value)}
          rows={3}
          placeholder="Describe the top scenarios you expect to use."
          className="resizable-textarea"
          aria-invalid={Boolean(props.errors.useCases)}
          aria-describedby={props.errors.useCases ? "use-cases-error" : undefined}
        />
        <InlineError id="use-cases-error" message={props.errors.useCases} />
      </label>
    </div>
  );
}

function PreferencesStep(props: {
  data: OnboardingFormData["preferences"];
  errors: StepErrors;
  onShortcutBehaviorChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}) {
  return (
    <div className="onboarding-fields">
      <label className="field">
        <span className="field-label">Shortcut preference (placeholder)</span>
        <input
          type="text"
          value={props.data.shortcutBehavior}
          onChange={(event) => props.onShortcutBehaviorChange(event.target.value)}
          placeholder="Open instantly with context from current app"
          aria-invalid={Boolean(props.errors.shortcutBehavior)}
          aria-describedby={props.errors.shortcutBehavior ? "shortcut-behavior-error" : undefined}
        />
        <InlineError id="shortcut-behavior-error" message={props.errors.shortcutBehavior} />
      </label>

      <label className="field">
        <span className="field-label">Additional notes (placeholder)</span>
        <textarea
          value={props.data.notes}
          onChange={(event) => props.onNotesChange(event.target.value)}
          rows={4}
          placeholder="Any preferences to keep for future onboarding fields."
          className="resizable-textarea"
          aria-invalid={Boolean(props.errors.notes)}
          aria-describedby={props.errors.notes ? "notes-error" : undefined}
        />
        <InlineError id="notes-error" message={props.errors.notes} />
      </label>
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

    return () => {
      isActive = false;
    };
  }, [onCompleted, supabase, user]);

  const activeStep = STEP_META[currentStep];

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
  };

  const applyValidationForCurrentStep = (): boolean => {
    const key = activeStep.key;
    const validation = validateStep(key, formData);
    setStepErrors((previous) => ({
      ...previous,
      [key]: validation,
    }));

    return Object.keys(validation).length === 0;
  };

  const handleSaveProgress = async () => {
    setSaveError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      await persistProgress({ completed: false, completedAt: null, nextStep: currentStep });
      setStatusMessage("Progress saved.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save progress.");
    } finally {
      setIsSaving(false);
    }
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
      setStatusMessage("Progress saved.");
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

    setSaveError(null);
    setStatusMessage(null);
    setIsSaving(true);

    try {
      const completedAt = new Date().toISOString();
      await persistProgress({ completed: true, completedAt, nextStep: LAST_STEP_INDEX });
      setStatusMessage("Onboarding completed.");
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
      <div className="panel onboarding-card">
        <header className="onboarding-header">
          <p className="eyebrow">
            Onboarding skeleton
          </p>
          <h1 className="onboarding-title">Set up Murmur</h1>
          <p>
            This is the Step 7 multi-step boilerplate. Field copy and final schema can evolve without replacing the flow.
          </p>
          <ol className="step-pills" aria-label="Onboarding steps">
            {STEP_META.map((step, index) => (
              <li
                key={step.key}
                className={`step-pill ${index === currentStep ? "step-pill-active" : ""}`}
                aria-current={index === currentStep ? "step" : undefined}
              >
                {index + 1}. {step.title}
              </li>
            ))}
          </ol>
        </header>

        <section className="section-card">
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
              onWorkspaceNameChange={(value) => {
                updateStepField("account", "workspaceName", value);
              }}
            />
          )}

          {activeStep.key === "workflow" && (
            <WorkflowStep
              data={formData.workflow}
              errors={stepErrors.workflow}
              onPrimaryGoalChange={(value) => {
                updateStepField("workflow", "primaryGoal", value);
              }}
              onUseCasesChange={(value) => {
                updateStepField("workflow", "useCases", value);
              }}
            />
          )}

          {activeStep.key === "preferences" && (
            <PreferencesStep
              data={formData.preferences}
              errors={stepErrors.preferences}
              onShortcutBehaviorChange={(value) => {
                updateStepField("preferences", "shortcutBehavior", value);
              }}
              onNotesChange={(value) => {
                updateStepField("preferences", "notes", value);
              }}
            />
          )}
        </section>

        {statusMessage && <p className="alert alert-info">{statusMessage}</p>}
        {saveError && <p className="alert alert-danger">{saveError}</p>}

        <footer className="footer-actions">
          <div className="action-group">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStep === 0 || isSaving}
              className="button button-secondary"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSaveProgress();
              }}
              disabled={isSaving}
              className="button button-secondary"
            >
              Save progress
            </button>
          </div>

          <div className="action-group">
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
                Complete onboarding
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
