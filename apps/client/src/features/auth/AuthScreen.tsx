import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

type AuthMode = "sign-in" | "sign-up" | "reset";

function titleForMode(mode: AuthMode): string {
  if (mode === "sign-up") {
    return "Create account";
  }

  if (mode === "reset") {
    return "Reset password";
  }

  return "Sign in";
}

export function AuthScreen() {
  const { signInWithPassword, signUpWithPassword, sendPasswordReset, signInWithGoogle, authError } = useAuth();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (!email.includes("@")) {
      return false;
    }

    if (mode === "reset") {
      return true;
    }

    return password.length >= 8;
  }, [email, mode, password]);

  const submitButtonLabel = mode === "sign-up" ? "Create account" : mode === "reset" ? "Send reset" : "Sign in";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setStatusMessage(null);
    setIsSubmitting(true);
    try {
      if (mode === "sign-up") {
        await signUpWithPassword(email, password);
        setStatusMessage("Sign-up submitted. Check email verification if prompted.");
        return;
      }

      if (mode === "reset") {
        await sendPasswordReset(email);
        setStatusMessage("Reset email sent if your account exists.");
        return;
      }

      await signInWithPassword(email, password);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(145deg, #0f172a 0%, #020617 100%)",
        color: "#e2e8f0",
        padding: "24px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: "420px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          background: "rgba(15, 23, 42, 0.88)",
          border: "1px solid rgba(148, 163, 184, 0.35)",
          borderRadius: "16px",
          padding: "20px",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "24px" }}>{titleForMode(mode)}</h1>
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px" }}
          />
        </label>
        {mode !== "reset" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              minLength={8}
              required
              style={{ borderRadius: "10px", border: "1px solid #334155", padding: "10px 12px" }}
            />
          </label>
        )}

        <button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          style={{
            borderRadius: "10px",
            border: "none",
            padding: "12px",
            background: "#0ea5e9",
            color: "#f8fafc",
            fontWeight: 700,
            opacity: !canSubmit || isSubmitting ? 0.6 : 1,
          }}
        >
          {isSubmitting ? "Working..." : submitButtonLabel}
        </button>

        <button
          type="button"
          onClick={() => {
            void signInWithGoogle();
          }}
          style={{
            borderRadius: "10px",
            border: "1px solid #334155",
            padding: "12px",
            background: "transparent",
            color: "#f8fafc",
            fontWeight: 600,
          }}
        >
          Continue with Google
        </button>

        {statusMessage && <p style={{ margin: 0, color: "#7dd3fc", fontSize: "14px" }}>{statusMessage}</p>}
        {authError && <p style={{ margin: 0, color: "#fda4af", fontSize: "14px" }}>{authError}</p>}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
          <button type="button" onClick={() => setMode("sign-in")} style={{ background: "none", border: "none", color: "#cbd5e1" }}>
            Sign in
          </button>
          <button type="button" onClick={() => setMode("sign-up")} style={{ background: "none", border: "none", color: "#cbd5e1" }}>
            Sign up
          </button>
          <button type="button" onClick={() => setMode("reset")} style={{ background: "none", border: "none", color: "#cbd5e1" }}>
            Forgot password
          </button>
        </div>
      </form>
    </div>
  );
}
