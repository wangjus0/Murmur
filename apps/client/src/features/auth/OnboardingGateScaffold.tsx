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

function InlineError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p style={{ margin: "4px 0 0", color: "#fda4af", fontSize: "13px" }}>{message}</p>;
}

function AccountStep(props: {
  data: OnboardingFormData["account"];
  errors: StepErrors;
  onDisplayNameChange: (value: string) => void;
  onWorkspaceNameChange: (value: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <label style={{ display: "grid", gap: "6px" }}>
        Display name (placeholder)
        <input
          type="text"
          value={props.data.displayName}
          onChange={(event) => props.onDisplayNameChange(event.target.value)}
          placeholder="Alex Rivera"
          style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px" }}
        />
        <InlineError message={props.errors.displayName} />
      </label>

      <label style={{ display: "grid", gap: "6px" }}>
        Workspace name (placeholder)
        <input
          type="text"
          value={props.data.workspaceName}
          onChange={(event) => props.onWorkspaceNameChange(event.target.value)}
          placeholder="Murmur Team"
          style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px" }}
        />
        <InlineError message={props.errors.workspaceName} />
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
    <div style={{ display: "grid", gap: "12px" }}>
      <label style={{ display: "grid", gap: "6px" }}>
        Primary goal (placeholder)
        <textarea
          value={props.data.primaryGoal}
          onChange={(event) => props.onPrimaryGoalChange(event.target.value)}
          rows={3}
          placeholder="What should Murmur help you accomplish first?"
          style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px", resize: "vertical" }}
        />
        <InlineError message={props.errors.primaryGoal} />
      </label>

      <label style={{ display: "grid", gap: "6px" }}>
        Frequent use cases (placeholder)
        <textarea
          value={props.data.useCases}
          onChange={(event) => props.onUseCasesChange(event.target.value)}
          rows={3}
          placeholder="Describe the top scenarios you expect to use."
          style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px", resize: "vertical" }}
        />
        <InlineError message={props.errors.useCases} />
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
    <div style={{ display: "grid", gap: "12px" }}>
      <label style={{ display: "grid", gap: "6px" }}>
        Shortcut preference (placeholder)
        <input
          type="text"
          value={props.data.shortcutBehavior}
          onChange={(event) => props.onShortcutBehaviorChange(event.target.value)}
          placeholder="Open instantly with context from current app"
          style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px" }}
        />
        <InlineError message={props.errors.shortcutBehavior} />
      </label>

      <label style={{ display: "grid", gap: "6px" }}>
        Additional notes (placeholder)
        <textarea
          value={props.data.notes}
          onChange={(event) => props.onNotesChange(event.target.value)}
          rows={4}
          placeholder="Any preferences to keep for future onboarding fields."
          style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px", resize: "vertical" }}
        />
        <InlineError message={props.errors.notes} />
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
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#020617",
          color: "#e2e8f0",
        }}
      >
        Loading onboarding...
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "linear-gradient(145deg, #020617 0%, #0b1120 100%)",
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          border: "1px solid #334155",
          borderRadius: "16px",
          padding: "24px",
          background: "rgba(15, 23, 42, 0.9)",
          display: "grid",
          gap: "16px",
        }}
      >
        <header style={{ display: "grid", gap: "10px" }}>
          <p style={{ margin: 0, color: "#7dd3fc", fontSize: "13px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Onboarding skeleton
          </p>
          <h1 style={{ margin: 0, fontSize: "28px" }}>Set up Murmur</h1>
          <p style={{ margin: 0, color: "#cbd5e1", lineHeight: 1.5 }}>
            This is the Step 7 multi-step boilerplate. Field copy and final schema can evolve without replacing the flow.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {STEP_META.map((step, index) => (
              <div
                key={step.key}
                style={{
                  borderRadius: "999px",
                  border: "1px solid #334155",
                  background: index === currentStep ? "#0ea5e9" : "transparent",
                  color: index === currentStep ? "#020617" : "#cbd5e1",
                  padding: "6px 10px",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                {index + 1}. {step.title}
              </div>
            ))}
          </div>
        </header>

        <section style={{ border: "1px solid #1e293b", borderRadius: "12px", padding: "16px", display: "grid", gap: "12px" }}>
          <div>
            <h2 style={{ margin: "0 0 6px", fontSize: "20px" }}>{activeStep.title}</h2>
            <p style={{ margin: 0, color: "#94a3b8" }}>{activeStep.description}</p>
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

        {statusMessage && <p style={{ margin: 0, color: "#7dd3fc" }}>{statusMessage}</p>}
        {saveError && <p style={{ margin: 0, color: "#fda4af" }}>{saveError}</p>}

        <footer style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStep === 0 || isSaving}
              style={{
                borderRadius: "10px",
                border: "1px solid #334155",
                padding: "10px 14px",
                background: "transparent",
                color: "#e2e8f0",
                opacity: currentStep === 0 || isSaving ? 0.55 : 1,
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSaveProgress();
              }}
              disabled={isSaving}
              style={{
                borderRadius: "10px",
                border: "1px solid #334155",
                padding: "10px 14px",
                background: "transparent",
                color: "#e2e8f0",
                opacity: isSaving ? 0.55 : 1,
              }}
            >
              Save progress
            </button>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              disabled={isSaving}
              style={{
                borderRadius: "10px",
                border: "1px solid #475569",
                background: "transparent",
                color: "#e2e8f0",
                padding: "10px 14px",
                opacity: isSaving ? 0.55 : 1,
              }}
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
                style={{
                  borderRadius: "10px",
                  border: "none",
                  padding: "10px 14px",
                  background: "#0ea5e9",
                  color: "#f8fafc",
                  fontWeight: 700,
                  opacity: isSaving ? 0.6 : 1,
                }}
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
                style={{
                  borderRadius: "10px",
                  border: "none",
                  padding: "10px 14px",
                  background: "#22c55e",
                  color: "#052e16",
                  fontWeight: 700,
                  opacity: isSaving ? 0.6 : 1,
                }}
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
