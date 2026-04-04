import { useEffect, useMemo, useState } from "react";
import { App } from "../../App";
import { getSupabaseClient } from "../../lib/supabase";
import { useAuth } from "./AuthProvider";
import { AuthScreen } from "./AuthScreen";
import { resolveGuardDestination } from "./guard";
import { OnboardingGateScaffold } from "./OnboardingGateScaffold";

type OnboardingStatus = {
  isLoading: boolean;
  isCompleted: boolean;
  loadError: string | null;
};

type OnboardingLookup = {
  completed: boolean;
};

const INITIAL_ONBOARDING_STATUS: OnboardingStatus = {
  isLoading: true,
  isCompleted: false,
  loadError: null,
};

export function AppShell() {
  const { user, isLoading } = useAuth();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>(INITIAL_ONBOARDING_STATUS);

  useEffect(() => {
    let isActive = true;

    const loadOnboardingStatus = async () => {
      if (!user) {
        if (isActive) {
          setOnboardingStatus({
            isLoading: false,
            isCompleted: false,
            loadError: null,
          });
        }
        return;
      }

      if (isActive) {
        setOnboardingStatus((previous) => ({
          ...previous,
          isLoading: true,
          loadError: null,
        }));
      }

      const { data, error } = await supabase
        .from("onboarding_responses")
        .select("completed")
        .eq("user_id", user.id)
        .maybeSingle<OnboardingLookup>();

      if (!isActive) {
        return;
      }

      if (error) {
        setOnboardingStatus({
          isLoading: false,
          isCompleted: false,
          loadError: error.message,
        });
        return;
      }

      setOnboardingStatus({
        isLoading: false,
        isCompleted: data?.completed === true,
        loadError: null,
      });
    };

    void loadOnboardingStatus();

    return () => {
      isActive = false;
    };
  }, [supabase, user]);

  if (isLoading || (user && onboardingStatus.isLoading)) {
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
        Checking session...
      </div>
    );
  }

  const destination = resolveGuardDestination(
    user,
    onboardingStatus.isCompleted,
  );
  if (destination === "auth") {
    return <AuthScreen />;
  }

  if (destination === "onboarding") {
    return (
      <OnboardingGateScaffold
        initialLoadError={onboardingStatus.loadError}
        onCompleted={() => {
          setOnboardingStatus({
            isLoading: false,
            isCompleted: true,
            loadError: null,
          });
        }}
      />
    );
  }

  return <App />;
}
