export type OAuthCallbackResult =
  | { type: "success"; code: string }
  | { type: "recovery"; tokenHash: string }
  | { type: "session"; accessToken: string; refreshToken: string }
  | { type: "error"; message: string }
  | { type: "ignored" };

export function parseOAuthCallback(callbackUrl: string): OAuthCallbackResult {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return {
      type: "error",
      message: "Invalid OAuth callback URL.",
    };
  }

  const isExpectedCallback =
    parsed.protocol === "murmur:" && parsed.hostname === "auth" && parsed.pathname === "/callback";
  if (!isExpectedCallback) {
    return { type: "ignored" };
  }

  const callbackError = parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
  if (callbackError) {
    return {
      type: "error",
      message: callbackError,
    };
  }

  const recoveryType = parsed.searchParams.get("type");
  const recoveryTokenHash = parsed.searchParams.get("token_hash");
  if (recoveryType === "recovery" && recoveryTokenHash) {
    return {
      type: "recovery",
      tokenHash: recoveryTokenHash,
    };
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    const hashParams = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (accessToken && refreshToken) {
      return {
        type: "session",
        accessToken,
        refreshToken,
      };
    }

    return {
      type: "error",
      message: "Missing OAuth authorization code.",
    };
  }

  return {
    type: "success",
    code,
  };
}
