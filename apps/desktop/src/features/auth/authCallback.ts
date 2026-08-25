export type OAuthCallbackResult =
  | { kind: "code"; code: string; method: OAuthCallbackMethod }
  | { kind: "session"; accessToken: string; refreshToken: string; method: "website" }
  | { kind: "error"; message: string; method: OAuthCallbackMethod }
  | null;

export type OAuthCallbackSource = "web" | "tauri";
export type OAuthCallbackMethod = "google" | "website";

function getCallbackParam(searchParams: URLSearchParams, hashParams: URLSearchParams, name: string) {
  return searchParams.get(name) ?? hashParams.get(name);
}

function getOAuthCallbackErrorMessage(error: string) {
  if (error.trim().toLowerCase() === "access_denied") {
    return "Sign-in was cancelled. Try again when you're ready.";
  }
  return "Sign-in could not be completed. Try again.";
}

function isWebCallbackUrl(url: URL, source: OAuthCallbackSource) {
  return source === "web" && ["/auth/callback", "/auth/callback/"].includes(url.pathname);
}

function isExactTauriAuthHost(url: URL) {
  return url.protocol === "drifty:"
    && url.hostname === "auth"
    && url.username === ""
    && url.password === ""
    && url.port === "";
}

function isTauriAuthCallbackUrl(url: URL, source: OAuthCallbackSource) {
  return source === "tauri"
    && isExactTauriAuthHost(url)
    && ["/callback", "/callback/"].includes(url.pathname);
}

function isTauriGoogleCallbackUrl(url: URL, source: OAuthCallbackSource) {
  return source === "tauri"
    && isExactTauriAuthHost(url)
    && ["/google-callback", "/google-callback/"].includes(url.pathname);
}

export function getOAuthCallbackResultFromUrl(value: string, source: OAuthCallbackSource): OAuthCallbackResult {
  try {
    const url = new URL(value);
    const isWebCallback = isWebCallbackUrl(url, source);
    const isTauriCallback = isTauriAuthCallbackUrl(url, source);
    const isTauriGoogleCallback = isTauriGoogleCallbackUrl(url, source);
    const method: OAuthCallbackMethod = isTauriGoogleCallback ? "google" : "website";

    if (!isWebCallback && !isTauriCallback && !isTauriGoogleCallback) {
      return null;
    }

    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const accessToken = getCallbackParam(url.searchParams, hashParams, "access_token");
    const refreshToken = getCallbackParam(url.searchParams, hashParams, "refresh_token");
    if (source === "tauri" && (accessToken || refreshToken)) {
      return {
        kind: "error",
        message: "Session token callbacks are no longer accepted. Sign in with email inside Drifty, or start Google sign-in again.",
        method,
      };
    }

    const error = getCallbackParam(url.searchParams, hashParams, "error");
    if (error) {
      return {
        kind: "error",
        message: getOAuthCallbackErrorMessage(error),
        method,
      };
    }

    const code = getCallbackParam(url.searchParams, hashParams, "code");
    if (code) {
      return { kind: "code", code, method };
    }

    if (accessToken && refreshToken) {
      return { kind: "session", accessToken, refreshToken, method: "website" };
    }

    if (isTauriGoogleCallback) {
      return {
        kind: "error",
        message: "Google OAuth callback did not include an authorization code.",
        method,
      };
    }

    return {
      kind: "error",
      message: "OAuth callback did not include a sign-in code.",
      method,
    };
  } catch {
    return null;
  }
}
