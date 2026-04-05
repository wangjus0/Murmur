export type OAuthCallbackResult =
  | { type: "success"; code: string }
  | { type: "otp"; tokenHash: string; otpType: SupportedOtpType }
  | { type: "session"; accessToken: string; refreshToken: string }
  | { type: "error"; message: string }
  | { type: "ignored" };

export type SupportedOtpType = "signup" | "recovery" | "invite" | "magiclink" | "email_change";

const SUPPORTED_OTP_TYPES: ReadonlySet<SupportedOtpType> = new Set([
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
]);

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

  const otpType = parsed.searchParams.get("type");
  const otpTokenHash = parsed.searchParams.get("token_hash");
  if (otpType && otpTokenHash && SUPPORTED_OTP_TYPES.has(otpType as SupportedOtpType)) {
    return {
      type: "otp",
      tokenHash: otpTokenHash,
      otpType: otpType as SupportedOtpType,
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
