import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

type AuthMode = "sign-in" | "sign-up" | "reset";

function titleForMode(mode: AuthMode): string {
  if (mode === "sign-up") {
    return "Start here, create your account";
  }

  if (mode === "reset") {
    return "Reset password to continue";
  }

  return "Log in, start your Murmur flow";
}

function descriptionForMode(mode: AuthMode): string {
  if (mode === "sign-up") {
    return "Create your workspace and unlock desktop voice workflows.";
  }

  if (mode === "reset") {
    return "We will send a secure reset link to your email address.";
  }

  return "Continue with the same calm shell, saved setup state, and voice-first controls.";
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
      <div className="auth-shell auth-shell-revamp">
        <div className="auth-visual-stage" aria-hidden="true">
          <div className="auth-ambient-glow auth-ambient-glow-left" />
          <div className="auth-ambient-glow auth-ambient-glow-right" />
          <div className="auth-figure-silhouette" />
          <div className="auth-stage-vignette" />
        </div>

        <div className="panel auth-card auth-card-cluely auth-card-revamp auth-card-desktop">
          <aside className="auth-desktop-copy">
            <div className="auth-brand-lockup auth-brand-lockup-desktop">
              <p className="auth-brand-mark">Murmur</p>
              <span className="auth-desktop-kicker">Desktop workspace</span>
            </div>

            <div className="auth-desktop-hero">
              <h1>{titleForMode(mode)}</h1>
              <p>{descriptionForMode(mode)}</p>
            </div>

            <div className="auth-desktop-features">
              <article className="auth-desktop-feature">
                <span className="auth-desktop-feature-label">Overlay</span>
                <strong>Unchanged</strong>
                <p>The voice pill stays out of the auth flow and out of the workspace chrome.</p>
              </article>
              <article className="auth-desktop-feature">
                <span className="auth-desktop-feature-label">Setup</span>
                <strong>Saved locally</strong>
                <p>Auth, onboarding progress, and voice preferences remain available between launches.</p>
              </article>
              <article className="auth-desktop-feature">
                <span className="auth-desktop-feature-label">Shell</span>
                <strong>Built for desktop</strong>
                <p>A wider, calmer composition that feels like a control room rather than a phone mockup.</p>
              </article>
            </div>
          </aside>

          <form onSubmit={handleSubmit} className={`auth-form-pane auth-card-mode-${mode}`}>
            <div className="mode-switch auth-mode-switch auth-mode-switch-compact">
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
                Reset
              </button>
            </div>

            <div className="auth-form-header">
              <h2>{titleForMode(mode)}</h2>
              <p>{descriptionForMode(mode)}</p>
            </div>

            <div className="auth-form-stack">
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
            </div>

            {mode === "sign-in" && (
              <div className="auth-inline-actions">
                <label className="auth-checkbox-row">
                  <input type="checkbox" />
                  <span>Remember me</span>
                </label>
                <button
                  type="button"
                  className="auth-link-button"
                  onClick={() => setMode("reset")}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <div className="auth-action-stack">
              <button type="submit" disabled={!canSubmit || isSubmitting} className="button button-primary">
                {isSubmitting ? "Working..." : submitButtonLabel}
              </button>

              <div className="auth-divider" aria-hidden="true">
                <span />
                <p>or continue with</p>
                <span />
              </div>

              <button
                type="button"
                onClick={() => {
                  void signInWithGoogle();
                }}
                className="button button-secondary auth-google-button"
              >
                Continue with Google
              </button>
            </div>

            {statusMessage && <p className="alert alert-info">{statusMessage}</p>}
            {authError && <p className="alert alert-danger">{authError}</p>}

            <div className="auth-footnote auth-footnote-revamp">
              {mode === "sign-in" && (
                <p>
                  Don&apos;t have an account?{" "}
                  <button type="button" className="auth-link-button" onClick={() => setMode("sign-up")}>
                    Create one
                  </button>
                </p>
              )}
              {mode === "sign-up" && (
                <p>
                  Already have an account?{" "}
                  <button type="button" className="auth-link-button" onClick={() => setMode("sign-in")}>
                    Log in
                  </button>
                </p>
              )}
              {mode === "reset" && (
                <p>
                  Remembered it?{" "}
                  <button type="button" className="auth-link-button" onClick={() => setMode("sign-in")}>
                    Back to login
                  </button>
                </p>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
