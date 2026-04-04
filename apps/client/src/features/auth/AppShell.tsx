import { App } from "../../App";
import { useAuth } from "./AuthProvider";
import { AuthScreen } from "./AuthScreen";
import { resolveGuardDestination } from "./guard";
import { OnboardingGateScaffold } from "./OnboardingGateScaffold";

export function AppShell() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
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

  const destination = resolveGuardDestination(user);
  if (destination === "auth") {
    return <AuthScreen />;
  }

  if (destination === "onboarding") {
    return <OnboardingGateScaffold />;
  }

  return <App />;
}
