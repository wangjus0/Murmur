import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./features/auth/AuthProvider";
import { AppShell } from "./features/auth/AppShell";
import { VoicePopover } from "./features/voice/VoicePopover";
import { getSupabaseClient } from "./lib/supabase";
import "./styles.css";

const isVoicePopover = window.location.hash === "#/voice-popover";
const runtimePlatform = window.desktop?.getRuntimeInfo?.().platform;

if (runtimePlatform === "darwin") {
  document.body.classList.add("runtime-macos");
}

if (!isVoicePopover && typeof window.desktop?.getSupabaseConfig === "function") {
  getSupabaseClient();
}

type StartupBoundaryState = {
  errorMessage: string | null;
};

class StartupBoundary extends Component<{ children: ReactNode }, StartupBoundaryState> {
  state: StartupBoundaryState = {
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): StartupBoundaryState {
    return {
      errorMessage: error instanceof Error ? error.message : "Unexpected startup error.",
    };
  }

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <div className="screen">
        <div className="panel error-card">
          <h1>Murmur failed to start</h1>
          <p>
            The app hit a startup error before rendering the main UI.
          </p>
          <p className="alert alert-danger break-anywhere">
            {this.state.errorMessage}
          </p>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  isVoicePopover ? (
    <VoicePopover />
  ) : (
    <StartupBoundary>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </StartupBoundary>
  ),
);
