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

function descriptionForMode(mode: AuthMode): string {
  if (mode === "sign-up") {
    return "Create your workspace and unlock hands-free browser workflows.";
  }

  if (mode === "reset") {
    return "We will send a secure reset link to your email address.";
  }

  return "Welcome back. Continue your current voice session securely.";
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
        setStatusMessage("Check your inbox for a verification email.");
        return;
      }

      if (mode === "reset") {
        await sendPasswordReset(email);
        setStatusMessage("Reset email sent if your account exists.");
        return;
      }

      await signInWithPassword(email, password);
    } catch {
      // AuthProvider already stores the visible authError message.
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="screen auth-screen">
      <div className="panel auth-shell">
        <aside className="auth-aside">
          <p className="eyebrow">Murmur Desktop</p>
          <h1 className="auth-brand-title">A focused workspace for voice-guided browser automation</h1>
          <p className="auth-brand-copy">
            Run hands-free workflows with clear state visibility, secure auth, and predictable controls designed for daily use.
          </p>
          <div className="auth-points">
            <div className="auth-point">Live transcript and timeline visibility.</div>
            <div className="auth-point">Interrupt and resume controls during execution.</div>
            <div className="auth-point">Guided onboarding with saved progress.</div>
          </div>
        </aside>

        <form onSubmit={handleSubmit} className="auth-card">
          <div className="auth-form-header">
            <p className="eyebrow">Authentication</p>
            <h2>{titleForMode(mode)}</h2>
            <p>{descriptionForMode(mode)}</p>
          </div>

          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          {mode !== "reset" && (
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                minLength={8}
                required
              />
            </label>
          )}

          <button type="submit" disabled={!canSubmit || isSubmitting} className="button button-primary">
            {isSubmitting ? "Working..." : submitButtonLabel}
          </button>

          <button
            type="button"
            onClick={() => {
              void signInWithGoogle();
            }}
            className="button button-secondary"
          >
            Continue with Google
          </button>

          {statusMessage && <p className="alert alert-info">{statusMessage}</p>}
          {authError && <p className="alert alert-danger">{authError}</p>}

          <div className="mode-switch">
            <button
              type="button"
              onClick={() => setMode("sign-in")}
              aria-pressed={mode === "sign-in"}
              className={`chip-button ${mode === "sign-in" ? "chip-active" : ""}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("sign-up")}
              aria-pressed={mode === "sign-up"}
              className={`chip-button ${mode === "sign-up" ? "chip-active" : ""}`}
            >
              Sign up
            </button>
            <button
              type="button"
              onClick={() => setMode("reset")}
              aria-pressed={mode === "reset"}
              className={`chip-button ${mode === "reset" ? "chip-active" : ""}`}
            >
              Forgot password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
