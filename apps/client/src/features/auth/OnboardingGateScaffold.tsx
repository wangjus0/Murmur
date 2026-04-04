import { useAuth } from "./AuthProvider";

export function OnboardingGateScaffold() {
  const { signOut } = useAuth();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#020617",
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          border: "1px solid #334155",
          borderRadius: "16px",
          padding: "20px",
          background: "#0f172a",
        }}
      >
        <h1 style={{ marginTop: 0 }}>Onboarding is required</h1>
        <p style={{ marginBottom: "18px", lineHeight: 1.5 }}>
          Your account is signed in, but onboarding is not completed yet. Step 7 will replace this scaffold with the
          full onboarding flow.
        </p>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          style={{
            borderRadius: "10px",
            border: "1px solid #475569",
            background: "transparent",
            color: "#e2e8f0",
            padding: "10px 14px",
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
