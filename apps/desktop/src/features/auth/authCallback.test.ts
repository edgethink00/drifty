import { describe, expect, it } from "vitest";

import { getOAuthCallbackResultFromUrl } from "./authCallback";

describe("OAuth callback parsing", () => {
  it.each([
    "drifty://auth/google-callback?code=google-code&access_token=secret",
    "drifty://auth/google-callback?code=google-code#refresh_token=secret",
    "drifty://auth/callback?access_token=secret",
  ])("rejects session token material in Tauri callbacks: %s", (url) => {
    expect(getOAuthCallbackResultFromUrl(url, "tauri")).toEqual({
      kind: "error",
      message: "Session token callbacks are no longer accepted. Sign in with email inside Drifty, or start Google sign-in again.",
      method: url.includes("google-callback") ? "google" : "website",
    });
  });

  it("reports an empty Google callback without attempting a code exchange", () => {
    expect(getOAuthCallbackResultFromUrl(
      "drifty://auth/google-callback?code=",
      "tauri",
    )).toEqual({
      kind: "error",
      message: "Google OAuth callback did not include an authorization code.",
      method: "google",
    });
  });

  it.each([
    ["maximum-length", "x".repeat(4_096), "x".repeat(4_096)],
    ["one-byte-over-limit", "x".repeat(4_097), "x".repeat(4_097)],
    ["malformed-percent-encoding", "%E0%A4%A", "�%A"],
  ])("routes a %s Google code to the bounded exchanger", (_name, encodedCode, decodedCode) => {
    expect(getOAuthCallbackResultFromUrl(
      `drifty://auth/google-callback?code=${encodedCode}`,
      "tauri",
    )).toEqual({
      kind: "code",
      code: decodedCode,
      method: "google",
    });
  });

  it.each([
    "not a url",
    "drifty://auth/callback-evil?code=ignored",
    "drifty://auth/google-callback/extra?code=ignored",
    "drifty://user@auth/google-callback?code=ignored",
  ])("ignores malformed or lookalike callback URLs: %s", (url) => {
    expect(getOAuthCallbackResultFromUrl(url, "tauri")).toBeNull();
  });

  it("keeps the legacy website session callback path web-only", () => {
    expect(getOAuthCallbackResultFromUrl(
      "https://drifty.so/auth/callback#access_token=access&refresh_token=refresh",
      "web",
    )).toEqual({
      kind: "session",
      accessToken: "access",
      refreshToken: "refresh",
      method: "website",
    });
  });
});
