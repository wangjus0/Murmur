export type OAuthCallbackResult =
  | { type: "success"; code: string }
  | { type: "otp"; tokenHash: string; otpType: SupportedOtpType }
  | { type: "session"; accessToken: string; refreshToken: string }
  | { type: "error"; message: string }
  | { type: "ignored" };

export type SupportedOtpType = "signup" | "recovery" | "invite" | "magiclink" | "email_change" | "email";

const SUPPORTED_OTP_TYPES: ReadonlySet<SupportedOtpType> = new Set([
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
  "email",
]);

const SUPPORTED_CALLBACK_PATHS: ReadonlySet<string> = new Set(["/callback", "/callback/", "/"]);

function getHashParams(parsedUrl: URL): URLSearchParams {
  return new URLSearchParams(parsedUrl.hash.startsWith("#") ? parsedUrl.hash.slice(1) : parsedUrl.hash);
}

function getFirstParam(searchParams: URLSearchParams, hashParams: URLSearchParams, key: string): string | null {
  return searchParams.get(key) ?? hashParams.get(key);
}

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
    parsed.protocol === "murmur:" && parsed.hostname === "auth" && SUPPORTED_CALLBACK_PATHS.has(parsed.pathname);
  if (!isExpectedCallback) {
    return { type: "ignored" };
  }

  const hashParams = getHashParams(parsed);
  const callbackError =
    getFirstParam(parsed.searchParams, hashParams, "error_description") ??
    getFirstParam(parsed.searchParams, hashParams, "error");
  if (callbackError) {
    return {
      type: "error",
      message: callbackError,
    };
  }

  const otpType = getFirstParam(parsed.searchParams, hashParams, "type");
  const otpTokenHash = getFirstParam(parsed.searchParams, hashParams, "token_hash");
  if (otpType && otpTokenHash && SUPPORTED_OTP_TYPES.has(otpType as SupportedOtpType)) {
    return {
      type: "otp",
      tokenHash: otpTokenHash,
      otpType: otpType as SupportedOtpType,
    };
  }

  const code = getFirstParam(parsed.searchParams, hashParams, "code");
  if (!code) {
    const accessToken = getFirstParam(parsed.searchParams, hashParams, "access_token");
    const refreshToken = getFirstParam(parsed.searchParams, hashParams, "refresh_token");
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
