import path from "node:path";
import { BrowserWindow } from "electron";

function resolvePreloadPath(): string {
  return path.join(__dirname, "..", "preload.js");
}

export function createVoicePopoverWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 420,
    height: 96,
    show: false,
    autoHideMenuBar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });
}
