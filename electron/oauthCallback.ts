const APP_PROTOCOL = "murmur";
const CALLBACK_HOSTNAME = "auth";
const CALLBACK_PATHNAME = "/callback";

function isSupportedCallbackPath(pathname: string): boolean {
  return pathname === CALLBACK_PATHNAME || pathname === `${CALLBACK_PATHNAME}/` || pathname === "/";
}

export function normalizeOAuthCallbackUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const isCallback =
      parsed.protocol === `${APP_PROTOCOL}:` &&
      parsed.hostname === CALLBACK_HOSTNAME &&
      isSupportedCallbackPath(parsed.pathname);

    if (!isCallback) {
      return null;
    }

    if (parsed.pathname === `${CALLBACK_PATHNAME}/`) {
      parsed.pathname = CALLBACK_PATHNAME;
    }

    if (parsed.pathname === "/") {
      parsed.pathname = CALLBACK_PATHNAME;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export class PendingOAuthCallbackStore {
  #pendingUrl: string | null = null;

  setFromRaw(rawUrl: string): string | null {
    const normalized = normalizeOAuthCallbackUrl(rawUrl);
    if (!normalized) {
      return null;
    }

    this.#pendingUrl = normalized;
    return normalized;
  }

  peek(): string | null {
    return this.#pendingUrl;
  }

  consume(): string | null {
    const callbackUrl = this.#pendingUrl;
    this.#pendingUrl = null;
    return callbackUrl;
  }
}
