import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

type SupabaseStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function readDesktopSupabaseConfig(): { url: string; anonKey: string } {
  const desktopApi = window.desktop;

  if (!desktopApi || typeof desktopApi.getSupabaseConfig !== "function") {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("Missing desktop Supabase bridge from preload.");
    }

    return { url, anonKey };
  }

  const config = desktopApi.getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error("Invalid Supabase config received from preload.");
  }

  return {
    url: config.url,
    anonKey: config.anonKey,
  };
}

function createSessionStorageAdapter(): SupabaseStorageAdapter {
  const authBridge = window.desktop?.auth;
  if (!authBridge) {
    return {
      getItem: async (key) => window.localStorage.getItem(key),
      setItem: async (key, value) => {
        window.localStorage.setItem(key, value);
      },
      removeItem: async (key) => {
        window.localStorage.removeItem(key);
      },
    };
  }

  return {
    getItem: (key) => authBridge.getSessionItem(key),
    setItem: (key, value) => authBridge.setSessionItem(key, value),
    removeItem: (key) => authBridge.removeSessionItem(key),
  };
}

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const { url, anonKey } = readDesktopSupabaseConfig();
  const storage = createSessionStorageAdapter();

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storage,
    },
  });

  return cachedClient;
}
