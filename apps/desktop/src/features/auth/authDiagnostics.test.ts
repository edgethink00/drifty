// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_DIAGNOSTICS_LIMIT,
  clearAuthDiagnostics,
  getDesktopSessionDiagnosticSummary,
  getSessionDiagnosticSummary,
  readAuthDiagnostics,
  recordAuthDiagnostic,
} from "./authDiagnostics";
import type { Session } from "@supabase/supabase-js";

function createSession(): Session {
  return {
    access_token: "raw-access-token",
    refresh_token: "raw-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "user-id",
      app_metadata: {},
      user_metadata: { email: "tester@example.com" },
      aud: "authenticated",
      created_at: new Date().toISOString(),
      is_anonymous: false,
    },
  } as Session;
}

describe("authDiagnostics", () => {
  beforeEach(() => {
    clearAuthDiagnostics({ mirrorToConsole: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearAuthDiagnostics({ mirrorToConsole: false });
  });

  it("stores bounded diagnostics in order", () => {
    for (let index = 0; index < AUTH_DIAGNOSTICS_LIMIT + 5; index += 1) {
      recordAuthDiagnostic("auth.test", { saveId: index, outcome: "ok" }, { mirrorToConsole: false });
    }

    const entries = readAuthDiagnostics();

    expect(entries).toHaveLength(AUTH_DIAGNOSTICS_LIMIT);
    expect(entries[0]?.payload.saveId).toBe(5);
    expect(entries[entries.length - 1]?.payload.saveId).toBe(AUTH_DIAGNOSTICS_LIMIT + 4);
    expect(entries[entries.length - 1]?.sequence).toBe(AUTH_DIAGNOSTICS_LIMIT + 5);
  });

  it("persists only allowlisted redacted payload fields", () => {
    recordAuthDiagnostic(
      "auth.callback raw event",
      {
        accessToken: "raw-access-token",
        refreshToken: "raw-refresh-token",
        email: "tester@example.com",
        url: "drifty://auth/callback#access_token=raw-access-token&refresh_token=raw-refresh-token",
        errorMessage: "Refresh failed for tester@example.com with access_token=raw-access-token refresh_token=raw-refresh-token SECRET_TOKEN=provider-secret API_KEY:provider-key Authorization: Bearer provider-bearer",
        eventType: "TOKEN_REFRESHED",
        hasSession: true,
      },
      { mirrorToConsole: false },
    );

    const serialized = JSON.stringify(readAuthDiagnostics());

    expect(serialized).toContain("TOKEN_REFRESHED");
    expect(serialized).not.toContain("raw-access-token");
    expect(serialized).not.toContain("raw-refresh-token");
    expect(serialized).not.toContain("tester@example.com");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("provider-key");
    expect(serialized).not.toContain("provider-bearer");
    expect(serialized).not.toContain("drifty://auth/callback");
    expect(serialized).toContain("[redacted-email]");
    expect(serialized).toContain("access_token=[redacted]");
    expect(serialized).toContain("refresh_token=[redacted]");
    expect(serialized).toContain("SECRET_TOKEN=[redacted]");
    expect(serialized).toContain("API_KEY=[redacted]");
    expect(serialized).toContain("Authorization: [redacted]");
  });

  it("summarizes sessions without raw tokens or user identifiers", () => {
    const summary = getSessionDiagnosticSummary(createSession());
    const desktopSummary = getDesktopSessionDiagnosticSummary({ accessToken: "saved-access", refreshToken: "saved-refresh" });
    const serialized = JSON.stringify({ summary, desktopSummary });

    expect(summary.hasSession).toBe(true);
    expect(summary.hasUser).toBe(true);
    expect(summary.hasAccessToken).toBe(true);
    expect(summary.hasRefreshToken).toBe(true);
    expect(typeof summary.accessTokenFingerprint).toBe("string");
    expect(typeof summary.refreshTokenFingerprint).toBe("string");
    expect(serialized).not.toContain("raw-access-token");
    expect(serialized).not.toContain("raw-refresh-token");
    expect(serialized).not.toContain("saved-access");
    expect(serialized).not.toContain("saved-refresh");
    expect(serialized).not.toContain("user-id");
  });

  it("does not throw when localStorage is unavailable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => recordAuthDiagnostic("auth.storage", { outcome: "failed" }, { mirrorToConsole: false })).not.toThrow();
    expect(() => readAuthDiagnostics()).not.toThrow();

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalled();
  });
});
