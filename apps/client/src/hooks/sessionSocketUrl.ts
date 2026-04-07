interface RuntimeLocationLike {
  protocol?: string;
  host?: string;
}

interface SessionSocketUrlInput {
  locationLike: RuntimeLocationLike;
  desktopSocketUrl?: string;
}

function normalizeDesktopSocketUrl(rawValue?: string): string | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveSessionSocketUrl({
  locationLike,
  desktopSocketUrl,
}: SessionSocketUrlInput): string {
  const normalizedDesktopSocketUrl = normalizeDesktopSocketUrl(desktopSocketUrl);
  // Electron exposes the API server URL from the main process (including PORT from
  // apps/server/.env). Prefer it even when the renderer is served from the Vite dev
  // origin so we do not depend on Vite's /ws proxy matching that port.
  if (normalizedDesktopSocketUrl) {
    return normalizedDesktopSocketUrl;
  }

  if (locationLike.protocol === "https:" || locationLike.protocol === "http:") {
    const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${locationLike.host}/ws`;
  }

  return "ws://127.0.0.1:3000/ws";
}
