import path from "node:path";
import { app, BrowserWindow } from "electron";

const MAIN_WINDOW_WIDTH = 1200;
const MAIN_WINDOW_HEIGHT = 800;
const DEV_RENDERER_ORIGIN = "http://localhost:5173";

let mainWindow: BrowserWindow | null = null;

function resolvePreloadPath(): string {
  return path.join(__dirname, "..", "preload.js");
}

function resolveRendererHtmlPath(): string {
  return path.join(__dirname, "..", "..", "apps", "client", "dist", "index.html");
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });
  const win = mainWindow;

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const isDev = !app.isPackaged;
  const canUseDevServer = Boolean(rendererUrl) && isDev;

  if (canUseDevServer && rendererUrl) {
    const parsedUrl = new URL(rendererUrl);
    if (parsedUrl.origin !== DEV_RENDERER_ORIGIN) {
      throw new Error(`Invalid ELECTRON_RENDERER_URL origin: ${parsedUrl.origin}`);
    }
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(resolveRendererHtmlPath());
  }

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  return mainWindow;
}
