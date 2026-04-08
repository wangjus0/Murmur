import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
  ipcMain,
  screen,
  session,
  shell,
  safeStorage,
  systemPreferences,
} from "electron";
import { readSupabasePublicConfig, type SupabasePublicConfig } from "./supabaseConfig";
import { createMainWindow, getMainWindow } from "./windows/mainWindow";
import { createVoicePopoverWindow } from "./windows/voicePopoverWindow";
import { isMicrophonePermission, isTrustedMicrophoneRequest } from "./permissions/mediaPermissions";
import { PendingOAuthCallbackStore } from "./oauthCallback";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

if (process.platform === "darwin" && !process.env.OS_ACTIVITY_MODE) {
  process.env.OS_ACTIVITY_MODE = "disable";
}

// Suppress EPIPE errors on stdout/stderr. These occur when the pipe consumer
// (e.g. the terminal that launched the app) disconnects while the main process
// is still running and tries to log. They are always benign in this context.
process.stdout.on("error", (err: NodeJS.ErrnoException) => { if (err.code !== "EPIPE") throw err; });
process.stderr.on("error", (err: NodeJS.ErrnoException) => { if (err.code !== "EPIPE") throw err; });

const MACOS_MENU_MODEL_WARNING =
  "representedObject is not a WeakPtrToElectronMenuModelAsNSObject";

function suppressKnownMacOsElectronMenuWarning(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
    const callback = typeof encoding === "function" ? encoding : cb;
    const normalizedEncoding = typeof encoding === "string" ? encoding : undefined;
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString(normalizedEncoding ?? "utf8")
          : String(chunk ?? "");

    if (text.includes(MACOS_MENU_MODEL_WARNING)) {
      if (callback) {
        callback(null);
      }
      return true;
    }

    try {
      return originalWrite(chunk as never, encoding as never, cb);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") throw err;
      return true;
    }
  }) as typeof process.stderr.write;
}

suppressKnownMacOsElectronMenuWarning();

let appReady = false;
let isQuitting = false;
let tray: Tray | null = null;
const pendingOAuthCallbackStore = new PendingOAuthCallbackStore();
let volatileSessionStore: SessionStoreData = {};
let voicePopoverWindow: BrowserWindow | null = null;
let voicePopoverOpenedAtMs: number | null = null;
let voicePopoverOpenedFromBackground = false;
let pendingVoicePopoverBlurHideTimer: NodeJS.Timeout | null = null;
// Module-level so hideVoicePopover / showVoicePopover can always cancel it.
let repositionAnimationId: ReturnType<typeof setInterval> | null = null;
let popoverTransitionAnimationId: ReturnType<typeof setInterval> | null = null;
// Track our *intent* to show the popover independently of OS/workspace
// visibility, which can flicker to false when switching Spaces on macOS.
// IPC handlers that reposition/resize/close should respect this flag so they
// don't operate on a window the user has already dismissed.
let voicePopoverIntentVisible = false;
let voicePopoverCollapsed = false;
let voicePopoverExpandingFromNotch = false;

function cancelRepositionAnimation(): void {
  if (repositionAnimationId !== null) {
    clearInterval(repositionAnimationId);
    repositionAnimationId = null;
  }
}

function cancelPopoverTransitionAnimation(): void {
  if (popoverTransitionAnimationId !== null) {
    clearInterval(popoverTransitionAnimationId);
    popoverTransitionAnimationId = null;
  }
}

function cancelPopoverAnimations(): void {
  cancelRepositionAnimation();
  cancelPopoverTransitionAnimation();
}

const GLOBAL_SHORTCUT = "CommandOrControl+Shift+Space";
const DASHBOARD_SHORTCUT = "CommandOrControl+Shift+M";

const APP_PROTOCOL = "murmur";
const OAUTH_CALLBACK_EVENT = "auth:oauth-callback";
const AUTH_STORE_FILENAME = "auth-session-store.bin";
const PROFILE_SYNC_COMMAND = "curl -fsSL https://browser-use.com/profile.sh | sh";
const PROFILE_SYNC_TIMEOUT_MS = 10 * 60 * 1000;

function setupStableApplicationMenu(): void {
  const commonViewSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
            ],
          },
          { label: "View", submenu: commonViewSubmenu },
          {
            label: "Window",
            submenu: [
              { role: "minimize" },
              { role: "zoom" },
              { type: "separator" },
              { role: "front" },
            ],
          },
        ]
      : [
          {
            label: "File",
            submenu: [{ role: "quit" }],
          },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "delete" },
              { role: "selectAll" },
            ],
          },
          { label: "View", submenu: commonViewSubmenu },
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerMediaPermissionHandlers(): void {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (!isMicrophonePermission(permission)) {
      return false;
    }

    return isTrustedMicrophoneRequest({
      requestingUrl: details?.requestingUrl,
      requestingOrigin,
      webContentsUrl: wc?.getURL(),
    });
  });

  defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!isMicrophonePermission(permission)) {
      callback(false);
      return;
    }

    callback(
      isTrustedMicrophoneRequest({
        requestingUrl: details?.requestingUrl,
        webContentsUrl: wc?.getURL(),
      })
    );
  });
}

type SessionStoreData = Readonly<Record<string, string>>;

function getSessionStorePath(): string {
  return path.join(app.getPath("userData"), AUTH_STORE_FILENAME);
}

function encodeSessionStore(store: SessionStoreData): Buffer {
  const payload = JSON.stringify(store);
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(payload);
  }

  return Buffer.from(payload, "utf8");
}

function decodeSessionStore(buffer: Buffer): SessionStoreData {
  try {
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString("utf8");
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce<SessionStoreData>((acc, [key, value]) => {
      if (typeof value !== "string") {
        return acc;
      }

      return {
        ...acc,
        [key]: value,
      };
    }, {});
  } catch {
    return {};
  }
}

function readSessionStore(): SessionStoreData {
  if (!safeStorage.isEncryptionAvailable()) {
    return volatileSessionStore;
  }

  const filePath = getSessionStorePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const payload = fs.readFileSync(filePath);
    return decodeSessionStore(payload);
  } catch {
    return {};
  }
}

function writeSessionStore(store: SessionStoreData): void {
  if (!safeStorage.isEncryptionAvailable()) {
    volatileSessionStore = store;
    return;
  }

  const filePath = getSessionStorePath();
  const payload = encodeSessionStore(store);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, payload);
}

function dispatchOAuthCallback(rawUrl: string): void {
  const callbackUrl = pendingOAuthCallbackStore.setFromRaw(rawUrl);
  if (!callbackUrl) {
    return;
  }

  emitPendingOAuthCallback();
}

function getOAuthCallbackFromArgv(argv: string[]): string | null {
  const callbackArg = argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
  return callbackArg ?? null;
}

function registerAsDefaultProtocolClient(): void {
  const processArguments = process.argv[1] ? [path.resolve(process.argv[1])] : [];
  const registered = process.defaultApp
    ? app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, processArguments)
    : app.setAsDefaultProtocolClient(APP_PROTOCOL);

  if (!registered) {
    console.error(`[electron] Failed to register protocol handler for ${APP_PROTOCOL}://`);
  }
}

function emitPendingOAuthCallback(): void {
  const pendingCallbackUrl = pendingOAuthCallbackStore.peek();
  if (!pendingCallbackUrl || !app.isReady()) {
    return;
  }

  const win = getMainWindow() ?? createMainWindow();
  win.webContents.send(OAUTH_CALLBACK_EVENT, pendingCallbackUrl);
  win.show();
  win.focus();
}

function registerAuthIpcHandlers(config: SupabasePublicConfig): void {
  const supabaseOrigin = new URL(config.url).origin;

  const assertValidStoreKey = (key: string): void => {
    if (!key || key.length > 200) {
      throw new Error("Invalid auth storage key.");
    }

    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new Error("Reserved auth storage key.");
    }
  };

  ipcMain.handle("system:open-external-url", async (_event, rawUrl: string) => {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only http(s) URLs are allowed.");
    }

    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle("auth:start-google-oauth", async (_event, authUrl: string) => {
    const parsed = new URL(authUrl);
    const isAllowedUrl =
      parsed.protocol === "https:" &&
      parsed.origin === supabaseOrigin &&
      parsed.pathname === "/auth/v1/authorize" &&
      parsed.searchParams.get("provider") === "google";
    if (!isAllowedUrl) {
      throw new Error("OAuth URL is not allowlisted.");
    }

    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle("auth:get-session-item", (_event, key: string) => {
    assertValidStoreKey(key);
    const store = readSessionStore();
    return store[key] ?? null;
  });

  ipcMain.handle("auth:set-session-item", (_event, key: string, value: string) => {
    assertValidStoreKey(key);
    const store = readSessionStore();
    const nextStore: SessionStoreData = {
      ...store,
      [key]: value,
    };
    writeSessionStore(nextStore);
  });

  ipcMain.handle("auth:remove-session-item", (_event, key: string) => {
    assertValidStoreKey(key);
    const store = readSessionStore();
    const nextStore = Object.entries(store).reduce<SessionStoreData>((acc, [storeKey, value]) => {
      if (storeKey === key) {
        return acc;
      }

      return {
        ...acc,
        [storeKey]: value,
      };
    }, {});
    writeSessionStore(nextStore);
  });

  ipcMain.handle("auth:consume-pending-oauth-callback", () => {
    return pendingOAuthCallbackStore.consume();
  });

  ipcMain.handle("permissions:request-microphone-access", async () => {
    if (typeof systemPreferences.askForMediaAccess !== "function") {
      return true;
    }

    try {
      return await systemPreferences.askForMediaAccess("microphone");
    } catch {
      return false;
    }
  });

  ipcMain.handle("permissions:get-microphone-access-status", () => {
    if (typeof systemPreferences.getMediaAccessStatus !== "function") {
      return "unsupported";
    }

    try {
      return systemPreferences.getMediaAccessStatus("microphone");
    } catch {
      return "unknown";
    }
  });

  ipcMain.handle("permissions:open-microphone-settings", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
      return;
    }

    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:privacy-microphone");
    }
  });

  ipcMain.handle("browser-use:start-profile-sync", async (_event, rawApiKey: string) => {
    const apiKey = normalizeBrowserUseApiKey(rawApiKey);
    if (!apiKey) {
      throw new Error("Invalid Browser Use API key format.");
    }

    if (process.platform !== "darwin" && process.platform !== "linux") {
      throw new Error("Automatic profile sync is currently supported on macOS and Linux.");
    }

    const runResult = await runProfileSyncCommand(apiKey);
    const combinedOutput = [runResult.stdout, runResult.stderr].filter(Boolean).join("\n");
    const profileId = extractProfileIdFromOutput(combinedOutput);

    return {
      success: runResult.exitCode === 0,
      profileId,
      message:
        runResult.exitCode === 0
          ? profileId
            ? "Profile sync completed."
            : "Profile sync completed. Copy the generated profile ID and paste it into onboarding."
          : "Profile sync failed. Review the output and retry.",
      output: combinedOutput.trim() || null,
    };
  });
}

type ProfileSyncRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runProfileSyncCommand(apiKey: string): Promise<ProfileSyncRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(PROFILE_SYNC_COMMAND, {
      shell: true,
      env: {
        ...process.env,
        BROWSER_USE_API_KEY: apiKey,
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Profile sync timed out. Please try again."));
    }, PROFILE_SYNC_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function normalizeBrowserUseApiKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^bu_[A-Za-z0-9_-]{8,}$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function extractProfileIdFromOutput(output: string): string | null {
  const uuidMatches =
    output.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi
    ) ?? [];
  if (uuidMatches.length > 0) {
    return uuidMatches[uuidMatches.length - 1] ?? null;
  }

  const prefixedMatches = output.match(/profile_[A-Za-z0-9_-]{6,}/gi) ?? [];
  if (prefixedMatches.length > 0) {
    return prefixedMatches[prefixedMatches.length - 1] ?? null;
  }

  return null;
}

function registerProtocolHandlers(): void {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    dispatchOAuthCallback(url);
  });

  app.on("second-instance", (_event, argv) => {
    const callbackArg = getOAuthCallbackFromArgv(argv);
    if (callbackArg) {
      dispatchOAuthCallback(callbackArg);
      return;
    }

    const win = getMainWindow() ?? createMainWindow();
    win.show();
    win.focus();
  });
}

function getOrCreateVoicePopover(): BrowserWindow {
  if (voicePopoverWindow && !voicePopoverWindow.isDestroyed()) {
    return voicePopoverWindow;
  }

  voicePopoverWindow = createVoicePopoverWindow();

  // Never auto-hide on blur — the overlay is user-controlled via the global
  // shortcut (toggle) or Escape. Auto-hiding on blur caused races with
  // app.focus(), unexpected dismissals when switching windows, and conflicts
  // with the reposition animation still running after hide.

  voicePopoverWindow.on("closed", () => {
    if (pendingVoicePopoverBlurHideTimer !== null) {
      clearTimeout(pendingVoicePopoverBlurHideTimer);
      pendingVoicePopoverBlurHideTimer = null;
    }

    cancelRepositionAnimation();
    cancelPopoverTransitionAnimation();
    voicePopoverOpenedAtMs = null;
    voicePopoverOpenedFromBackground = false;
    voicePopoverIntentVisible = false;
    voicePopoverCollapsed = false;
    voicePopoverExpandingFromNotch = false;
    voicePopoverWindow = null;
  });

  return voicePopoverWindow;
}

function showVoicePopover(): void {
  const win = getOrCreateVoicePopover();

  if (pendingVoicePopoverBlurHideTimer !== null) {
    clearTimeout(pendingVoicePopoverBlurHideTimer);
    pendingVoicePopoverBlurHideTimer = null;
  }

  // Cancel any popover animation that was running from a previous session —
  // this is the main cause of "unexpected location" bugs on re-toggle.
  cancelPopoverAnimations();

  voicePopoverOpenedAtMs = Date.now();
  voicePopoverOpenedFromBackground = BrowserWindow.getFocusedWindow() === null;

  const wasCollapsed = voicePopoverCollapsed;

  // Mark intent BEFORE show()/animate so that any IPC that fires immediately
  // after sees the correct state.
  voicePopoverIntentVisible = true;

  // If currently collapsed as a bottom notch, animate back to centered home.
  if (wasCollapsed) {
    const { x: waX, y: waY, width: waW, height: waH } = getActiveWorkArea();
    const targetX = Math.round(waX + (waW - POPOVER_WIDTH) / 2);
    const targetY = Math.round(waY + waH * 0.75 - PILL_TOP_OFFSET);

    // Flip renderer state immediately so it can morph from notch -> pill while
    // the window is traveling upward.
    voicePopoverCollapsed = false;
    voicePopoverExpandingFromNotch = true;
    win.webContents.send("popover:collapsed-changed", false);

    animatePopoverGeometry(targetX, targetY, POPOVER_WIDTH, POPOVER_HEIGHT_BASE, 280, () => {
      if (!voicePopoverWindow || voicePopoverWindow.isDestroyed()) return;
      voicePopoverExpandingFromNotch = false;
      voicePopoverWindow.webContents.send("popover:did-show");
    });
  } else {
    voicePopoverCollapsed = false;
    voicePopoverExpandingFromNotch = false;
    win.webContents.send("popover:collapsed-changed", false);
    // Snap to a clean centered position and reset to base height BEFORE show()
    // so the window never flashes at the wrong size or position.
    snapPopoverToCenter();
  }

  // Re-assert the window level — macOS can reset it between shows.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Activate the Electron app BEFORE show+focus so macOS doesn't give focus
  // back to the previously active app after win.focus().
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  } else {
    app.focus();
  }

  win.show();
  win.moveTop();
  win.focus();

  // Notify the renderer that the popover was just shown so it can re-apply
  // the correct window size (e.g. when a response card is already visible).
  if (!wasCollapsed) {
    win.webContents.send("popover:did-show");
  }
}

function collapseVoicePopoverToNotch(): void {
  const win = getOrCreateVoicePopover();

  if (pendingVoicePopoverBlurHideTimer !== null) {
    clearTimeout(pendingVoicePopoverBlurHideTimer);
    pendingVoicePopoverBlurHideTimer = null;
  }

  cancelPopoverAnimations();

  voicePopoverIntentVisible = false;
  voicePopoverCollapsed = true;
  voicePopoverExpandingFromNotch = false;
  voicePopoverOpenedAtMs = null;
  voicePopoverOpenedFromBackground = false;

  win.webContents.send("popover:collapsed-changed", true);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.show();
  win.moveTop();

  const { x, y } = getBottomCenterTarget(POPOVER_NOTCH_WIDTH, POPOVER_NOTCH_HEIGHT);
  animatePopoverGeometry(x, y, POPOVER_NOTCH_WIDTH, POPOVER_NOTCH_HEIGHT, 360);
}

function toggleVoicePopover(): void {
  // Use voicePopoverIntentVisible rather than win.isVisible() because macOS
  // can mark the window as not-visible when switching Spaces even though we
  // intentionally showed it. Relying on isVisible() causes double-show or
  // double-hide races when the user switches windows and re-triggers.
  if (voicePopoverIntentVisible) {
    collapseVoicePopoverToNotch();
  } else if (voicePopoverCollapsed) {
    showVoicePopover();
  } else {
    showVoicePopover();
  }
}

function toggleMainWindow(): void {
  const existingWindow = getMainWindow();
  if (existingWindow) {
    if (existingWindow.isVisible()) {
      existingWindow.hide();
      return;
    }

    existingWindow.show();
    existingWindow.focus();
    return;
  }

  const win = createMainWindow();
  win.show();
  win.focus();
}

function hideVoicePopover(): void {
  if (pendingVoicePopoverBlurHideTimer !== null) {
    clearTimeout(pendingVoicePopoverBlurHideTimer);
    pendingVoicePopoverBlurHideTimer = null;
  }

  // Always cancel any in-progress popover animation before hiding.
  // If left running, it continues moving the window while hidden and causes
  // "unexpected location" on the next show.
  cancelPopoverAnimations();

  // Mark intent BEFORE hide() so that any in-flight IPC from the renderer
  // (repositionPopover, resizePopover) that arrives after we call hide()
  // is correctly ignored.
  voicePopoverIntentVisible = false;
  voicePopoverCollapsed = false;
  voicePopoverExpandingFromNotch = false;

  voicePopoverOpenedAtMs = null;
  voicePopoverOpenedFromBackground = false;

  if (voicePopoverWindow && !voicePopoverWindow.isDestroyed()) {
    voicePopoverWindow.webContents.send("popover:collapsed-changed", false);
    // Reset to base size before hiding so the next show() starts clean.
    voicePopoverWindow.setSize(POPOVER_WIDTH, POPOVER_HEIGHT_BASE);
    // hide() is safe to call even if the window is already hidden.
    voicePopoverWindow.hide();
  }
}

const POPOVER_WIDTH = 430;
const POPOVER_HEIGHT_BASE = 130;
const PILL_TOP_OFFSET = 34; // padding(8) + half pill height(26)
const POPOVER_NOTCH_WIDTH = 96;
const POPOVER_NOTCH_HEIGHT = 20;
const POPOVER_NOTCH_BOTTOM_MARGIN = 8;

/** Returns the work-area of whichever display the cursor is currently on. */
function getActiveWorkArea(): Electron.Rectangle {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return display.workArea;
}

function getBottomCenterTarget(width: number, height: number): { x: number; y: number } {
  const { x: waX, y: waY, width: waW, height: waH } = getActiveWorkArea();
  return {
    x: Math.round(waX + (waW - width) / 2),
    y: Math.round(waY + waH - height - POPOVER_NOTCH_BOTTOM_MARGIN),
  };
}

function animatePopoverGeometry(
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  durationMs = 320,
  onDone?: () => void,
): void {
  if (!voicePopoverWindow || voicePopoverWindow.isDestroyed()) return;

  cancelPopoverTransitionAnimation();

  const [startX, startY] = voicePopoverWindow.getPosition();
  const [startWidth, startHeight] = voicePopoverWindow.getSize();
  const startTime = Date.now();
  const INTERVAL_MS = 10;
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

  popoverTransitionAnimationId = setInterval(() => {
    if (!voicePopoverWindow || voicePopoverWindow.isDestroyed()) {
      cancelPopoverTransitionAnimation();
      return;
    }

    const elapsed = Date.now() - startTime;
    const t = Math.min(elapsed / durationMs, 1);
    const ease = easeOutCubic(t);

    const width = Math.round(startWidth + (targetWidth - startWidth) * ease);
    const height = Math.round(startHeight + (targetHeight - startHeight) * ease);
    const x = Math.round(startX + (targetX - startX) * ease);
    const y = Math.round(startY + (targetY - startY) * ease);

    voicePopoverWindow.setSize(width, height);
    voicePopoverWindow.setPosition(x, y);

    if (t >= 1) {
      cancelPopoverTransitionAnimation();
      onDone?.();
    }
  }, INTERVAL_MS);
}

/** Snaps the popover to its centered home position on the active display, no animation. */
function snapPopoverToCenter(): void {
  if (!voicePopoverWindow || voicePopoverWindow.isDestroyed()) return;
  const { x: waX, y: waY, width: waW, height: waH } = getActiveWorkArea();
  const x = Math.round(waX + (waW - POPOVER_WIDTH) / 2);
  const y = Math.round(waY + waH * 0.75 - PILL_TOP_OFFSET);
  voicePopoverWindow.setSize(POPOVER_WIDTH, POPOVER_HEIGHT_BASE);
  voicePopoverWindow.setPosition(x, y);
}

function registerShortcutIpcHandlers(): void {
  ipcMain.handle("shortcut:close-popover", () => {
    hideVoicePopover();
  });

  ipcMain.handle("shortcut:show-popover", () => {
    if (!voicePopoverIntentVisible) {
      showVoicePopover();
    } else {
      // Re-assert on top even if already visible (e.g. something covered it)
      const win = getOrCreateVoicePopover();
      win.setAlwaysOnTop(true, "screen-saver");
      win.moveTop();
      win.focus();
    }
  });

  ipcMain.handle("shortcut:reposition-popover", (_event, position: "center" | "top-right" | "top-center" | "bottom-center") => {
    // Guard: only reposition when we intentionally have the popover shown.
    // If the window was hidden (e.g. user dismissed it) but the renderer fired
    // a repositionPopover IPC before unmounting, ignore it completely.
    if (!voicePopoverIntentVisible || !voicePopoverWindow || voicePopoverWindow.isDestroyed()) return;
    if (voicePopoverExpandingFromNotch) return;
    const { x: waX, y: waY, width: waW, height: waH } = getActiveWorkArea();
    const [currentWidth, currentHeight] = voicePopoverWindow.getSize();

    let targetX: number;
    let targetY: number;
    if (position === "top-right") {
      targetX = Math.round(waX + waW - currentWidth - 16);
      targetY = Math.round(waY + 16);
    } else if (position === "top-center") {
      targetX = Math.round(waX + (waW - currentWidth) / 2);
      targetY = Math.round(waY + 12);
    } else if (position === "bottom-center") {
      targetX = Math.round(waX + (waW - currentWidth) / 2);
      targetY = Math.round(waY + waH - currentHeight - POPOVER_NOTCH_BOTTOM_MARGIN);
    } else {
      targetX = Math.round(waX + (waW - currentWidth) / 2);
      targetY = Math.round(waY + waH * 0.75 - PILL_TOP_OFFSET);
    }

    // Cancel any in-progress animation before starting a new one.
    cancelRepositionAnimation();

    const [startX, startY] = voicePopoverWindow.getPosition();
    const DURATION_MS = 380;
    const INTERVAL_MS = 10;
    const startTime = Date.now();

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    repositionAnimationId = setInterval(() => {
      // Stop immediately if the popover was hidden mid-animation.
      if (!voicePopoverIntentVisible || !voicePopoverWindow || voicePopoverWindow.isDestroyed()) {
        cancelRepositionAnimation();
        return;
      }
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / DURATION_MS, 1);
      const ease = easeOutCubic(t);
      const x = Math.round(startX + (targetX - startX) * ease);
      const y = Math.round(startY + (targetY - startY) * ease);
      voicePopoverWindow.setPosition(x, y);
      if (t >= 1) {
        cancelRepositionAnimation();
      }
    }, INTERVAL_MS);
  });

  ipcMain.handle("shortcut:resize-popover", (_event, width: number, height: number, anchorBottom?: boolean) => {
    // Guard: ignore resize requests when the popover is not intentionally shown.
    if (!voicePopoverIntentVisible || !voicePopoverWindow || voicePopoverWindow.isDestroyed()) return;
    if (voicePopoverExpandingFromNotch) return;
    const [oldW, oldH] = voicePopoverWindow.getSize();
    const [oldX, oldY] = voicePopoverWindow.getPosition();
    voicePopoverWindow.setSize(Math.round(width), Math.round(height));
    const dx = Math.round((oldW - width) / 2);
    // anchorBottom: keep the bottom edge fixed so the window grows upward
    const dy = anchorBottom ? Math.round(oldH - height) : 0;
    voicePopoverWindow.setPosition(oldX + dx, oldY + dy);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function bootstrap(): Promise<void> {
  if (appReady) {
    return;
  }

  appReady = true;

  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return;
  }

  const supabaseConfig = readSupabasePublicConfig();
  registerProtocolHandlers();
  const initialOAuthCallback = getOAuthCallbackFromArgv(process.argv);
  if (initialOAuthCallback) {
    dispatchOAuthCallback(initialOAuthCallback);
  }
  await app.whenReady();
  registerAsDefaultProtocolClient();
  setupStableApplicationMenu();

  registerAuthIpcHandlers(supabaseConfig);
  registerShortcutIpcHandlers();
  registerMediaPermissionHandlers();

  const mainWin = createMainWindow();
  mainWin.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWin.hide();
    }
  });

  // System tray so the app is accessible after the main window is hidden
  const trayIconPath = path.join(__dirname, "../../build/icons/icon.iconset/icon_16x16@2x.png");
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(trayIcon);
  tray.setToolTip(`Murmur  (${GLOBAL_SHORTCUT})`);
  const trayMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        mainWin.show();
        mainWin.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit Murmur",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(trayMenu);
  tray.on("click", () => {
    if (mainWin.isVisible()) {
      mainWin.hide();
    } else {
      mainWin.show();
      mainWin.focus();
    }
  });

  emitPendingOAuthCallback();

  const registeredVoiceShortcut = globalShortcut.register(GLOBAL_SHORTCUT, toggleVoicePopover);
  if (!registeredVoiceShortcut || !globalShortcut.isRegistered(GLOBAL_SHORTCUT)) {
    console.error("[electron] Failed to register global shortcut:", GLOBAL_SHORTCUT);
  }

  const registeredDashboardShortcut = globalShortcut.register(DASHBOARD_SHORTCUT, toggleMainWindow);
  if (!registeredDashboardShortcut || !globalShortcut.isRegistered(DASHBOARD_SHORTCUT)) {
    console.error("[electron] Failed to register global shortcut:", DASHBOARD_SHORTCUT);
  }

  app.on("activate", () => {
    if (appReady && app.isReady() && process.platform === "darwin") {
      createMainWindow();
    }
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
});

app.on("window-all-closed", async () => {
  await wait(1);
});

void bootstrap();
