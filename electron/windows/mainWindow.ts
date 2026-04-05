import path from "node:path";
import { app, BrowserWindow } from "electron";

const MAIN_WINDOW_WIDTH = 1200;
const MAIN_WINDOW_HEIGHT = 800;
const DEV_RENDERER_ORIGIN = "http://localhost:5173";
const DEV_SERVER_BOOT_TIMEOUT_MS = 15_000;
const DEV_SERVER_RETRY_DELAY_MS = 300;

let mainWindow: BrowserWindow | null = null;

type CreateMainWindowOptions = {
  showOnReady?: boolean;
};

function resolvePreloadPath(): string {
  return path.join(__dirname, "..", "preload.js");
}

function resolveRendererHtmlPath(): string {
  return path.join(__dirname, "..", "..", "apps", "client", "dist", "index.html");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStartupErrorPage(message: string): string {
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Murmur startup error</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #020617; color: #e2e8f0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 24px; }
      .card { width: min(680px, 100%); border: 1px solid #334155; border-radius: 14px; padding: 20px; background: rgba(15, 23, 42, 0.95); }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0 0 10px; color: #cbd5e1; line-height: 1.5; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; border-radius: 10px; background: #1e293b; color: #fda4af; padding: 10px 12px; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Murmur could not load UI</h1>
      <p>The renderer failed before it could display the app.</p>
      <pre>${safeMessage}</pre>
    </main>
  </body>
</html>`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function canReachDevServer(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRendererFromDevServer(win: BrowserWindow, url: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEV_SERVER_BOOT_TIMEOUT_MS) {
    if (await canReachDevServer(url)) {
      await win.loadURL(url);
      return;
    }

    await wait(DEV_SERVER_RETRY_DELAY_MS);
  }

  throw new Error(`Timed out waiting for renderer at ${url}`);
}

export function createMainWindow(options: CreateMainWindowOptions = {}): BrowserWindow {
  const { showOnReady = true } = options;
  const isMac = process.platform === "darwin";

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (showOnReady) {
      mainWindow.show();
      mainWindow.focus();
    }

    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#090c17",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
        }
      : {}),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });
  const win = mainWindow;

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    const message = `Failed to load ${validatedUrl || "renderer"} (code ${errorCode}): ${errorDescription}`;
    console.error("[electron]", message);
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderStartupErrorPage(message))}`);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    const message = `Renderer process exited: ${details.reason}`;
    console.error("[electron]", message);
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderStartupErrorPage(message))}`);
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const isDev = !app.isPackaged;
  const canUseDevServer = Boolean(rendererUrl) && isDev;

  if (canUseDevServer && rendererUrl) {
    const parsedUrl = new URL(rendererUrl);
    if (parsedUrl.origin !== DEV_RENDERER_ORIGIN) {
      throw new Error(`Invalid ELECTRON_RENDERER_URL origin: ${parsedUrl.origin}`);
    }
    void loadRendererFromDevServer(win, rendererUrl).catch((error) => {
      console.error("[electron] Failed to load renderer URL:", error);
      void win.loadFile(resolveRendererHtmlPath());
    });
  } else {
    void win.loadFile(resolveRendererHtmlPath());
  }

  win.once("ready-to-show", () => {
    if (!showOnReady) {
      return;
    }

    win.show();
  });

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  return mainWindow;
}
