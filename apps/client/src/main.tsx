import { createRoot } from "react-dom/client";
import { AuthProvider } from "./features/auth/AuthProvider";
import { AppShell } from "./features/auth/AppShell";
import { VoicePopover } from "./features/voice/VoicePopover";
import { getSupabaseClient } from "./lib/supabase";

const isVoicePopover = window.location.hash === "#/voice-popover";

if (!isVoicePopover && typeof window.desktop?.getSupabaseConfig === "function") {
  getSupabaseClient();
}

createRoot(document.getElementById("root")!).render(
  isVoicePopover ? (
    <VoicePopover />
  ) : (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  ),
);
