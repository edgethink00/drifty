export type OAuthCallbackResult =
  | { kind: "code"; code: string }
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "error"; message: string }
  | null;

export type OAuthCallbackSource = "web" | "tauri";

function getCallbackParam(searchParams: URLSearchParams, hashParams: URLSearchParams, name: string) {
  return searchParams.get(name) ?? hashParams.get(name);
}

function getOAuthCallbackErrorMessage(error: string, description: string | null) {
  return description?.trim() || error;
}

function isWebCallbackUrl(url: URL, source: OAuthCallbackSource) {
  return source === "web" && ["/auth/callback", "/auth/callback/"].includes(url.pathname);
}

function isTauriAuthCallbackUrl(url: URL, source: OAuthCallbackSource) {
  return source === "tauri"
    && url.protocol === "drifty:"
    && url.hostname === "auth"
    && ["/callback", "/callback/"].includes(url.pathname);
}

function isTauriGoogleCallbackUrl(url: URL, source: OAuthCallbackSource) {
  return source === "tauri"
    && url.protocol === "drifty:"
    && url.hostname === "auth"
    && ["/google-callback", "/google-callback/"].includes(url.pathname);
}

export function getOAuthCallbackResultFromUrl(value: string, source: OAuthCallbackSource): OAuthCallbackResult {
  try {
    const url = new URL(value);
    const isWebCallback = isWebCallbackUrl(url, source);
    const isTauriCallback = isTauriAuthCallbackUrl(url, source);
    const isTauriGoogleCallback = isTauriGoogleCallbackUrl(url, source);

    if (!isWebCallback && !isTauriCallback && !isTauriGoogleCallback) {
      return null;
    }

    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const error = getCallbackParam(url.searchParams, hashParams, "error");
    if (error) {
      return {
        kind: "error",
        message: `OAuth callback failed: ${getOAuthCallbackErrorMessage(error, getCallbackParam(url.searchParams, hashParams, "error_description"))}`,
      };
    }

    const code = getCallbackParam(url.searchParams, hashParams, "code");
    if (code) {
      return { kind: "code", code };
    }

    const accessToken = getCallbackParam(url.searchParams, hashParams, "access_token");
    const refreshToken = getCallbackParam(url.searchParams, hashParams, "refresh_token");
    if (accessToken && refreshToken) {
      if (source === "tauri") {
        return {
          kind: "error",
          message: "Session token callbacks are no longer accepted. Sign in with email inside Drifty, or start Google sign-in again.",
        };
      }

      return { kind: "session", accessToken, refreshToken };
    }

    if (isTauriGoogleCallback) {
      return {
        kind: "error",
        message: "Google OAuth callback did not include an authorization code.",
      };
    }

    return {
      kind: "error",
      message: "OAuth callback did not include a sign-in code.",
    };
  } catch {
    return null;
  }
}
