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
  const windowWidth = 430;
  const windowHeight = 86;
  const edgeOffset = 24;

  const win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreenable: false,
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
  const { x: workAreaX, y: workAreaY, width: workAreaWidth, height: workAreaHeight } = primaryDisplay.workArea;
  const centeredX = Math.round(workAreaX + (workAreaWidth - windowWidth) / 2);
  const bottomY = Math.round(workAreaY + workAreaHeight - windowHeight - edgeOffset);
  win.setPosition(centeredX, bottomY);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

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
