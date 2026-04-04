import { createRoot } from "react-dom/client";
import { AuthProvider } from "./features/auth/AuthProvider";
import { AppShell } from "./features/auth/AppShell";
import { getSupabaseClient } from "./lib/supabase";

if (typeof window.desktop?.getSupabaseConfig === "function") {
  getSupabaseClient();
}

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <AppShell />
  </AuthProvider>,
);
