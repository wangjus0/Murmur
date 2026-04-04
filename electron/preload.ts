import { contextBridge, ipcRenderer } from "electron";
import { readSupabasePublicConfig } from "./supabaseConfig";

type OAuthCallbackListener = (callbackUrl: string) => void;

const desktopApi = Object.freeze({
  ping: () => "pong",
  getRuntimeInfo: () => ({
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  getSupabaseConfig: () => Object.freeze(readSupabasePublicConfig()),
  auth: {
    startGoogleOAuth: (authUrl: string) => ipcRenderer.invoke("auth:start-google-oauth", authUrl),
    getSessionItem: (key: string) => ipcRenderer.invoke("auth:get-session-item", key),
    setSessionItem: (key: string, value: string) =>
      ipcRenderer.invoke("auth:set-session-item", key, value),
    removeSessionItem: (key: string) => ipcRenderer.invoke("auth:remove-session-item", key),
    consumePendingOAuthCallback: () => ipcRenderer.invoke("auth:consume-pending-oauth-callback"),
    onOAuthCallback: (listener: OAuthCallbackListener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, callbackUrl: string) => {
        listener(callbackUrl);
      };

      ipcRenderer.on("auth:oauth-callback", wrappedListener);

      return () => {
        ipcRenderer.removeListener("auth:oauth-callback", wrappedListener);
      };
    },
  },
});

contextBridge.exposeInMainWorld("desktop", desktopApi);
