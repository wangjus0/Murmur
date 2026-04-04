type DesktopRuntimeInfo = {
  platform: string;
  electron: string;
  chrome: string;
  node: string;
};

type DesktopSupabaseConfig = {
  url: string;
  anonKey: string;
};

type DesktopAuthApi = {
  startGoogleOAuth: (authUrl: string) => Promise<void>;
  getSessionItem: (key: string) => Promise<string | null>;
  setSessionItem: (key: string, value: string) => Promise<void>;
  removeSessionItem: (key: string) => Promise<void>;
  consumePendingOAuthCallback: () => Promise<string | null>;
  onOAuthCallback: (listener: (callbackUrl: string) => void) => () => void;
};

type DesktopApi = {
  ping: () => string;
  getRuntimeInfo: () => DesktopRuntimeInfo;
  getSupabaseConfig: () => DesktopSupabaseConfig;
  auth?: DesktopAuthApi;
};

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export {};
