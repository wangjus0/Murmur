import path from "node:path";
import { app, BrowserWindow, screen } from "electron";

const DEV_RENDERER_ORIGIN = "http://localhost:5173";

function resolvePreloadPath(): string {
  return path.join(__dirname, "..", "preload.js");
}

function resolveRendererHtmlPath(): string {
  return path.join(__dirname, "..", "..", "apps", "client", "dist", "index.html");
}

export function createVoicePopoverWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 96,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
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

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const winWidth = 420;
  win.setPosition(Math.round((screenWidth - winWidth) / 2), 48);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const isDev = !app.isPackaged;
  const canUseDevServer = Boolean(rendererUrl) && isDev;

  if (canUseDevServer && rendererUrl) {
    const parsedUrl = new URL(rendererUrl);
    if (parsedUrl.origin !== DEV_RENDERER_ORIGIN) {
      throw new Error(`Invalid ELECTRON_RENDERER_URL origin: ${parsedUrl.origin}`);
    }
    void win.loadURL(`${rendererUrl}#/voice-popover`);
  } else {
    void win.loadFile(resolveRendererHtmlPath(), { hash: "/voice-popover" });
  }

  return win;
}
