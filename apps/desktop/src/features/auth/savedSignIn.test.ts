import { describe, expect, it } from "vitest";
import {
  isAuthServerUnreachableError,
  isStoredAuthSessionExpired,
  parseStoredAuthSession,
  resolveSavedSignInUser,
} from "./savedSignIn";

function testAccessToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

function storedSession(user: Record<string, unknown> | null, subject = "user-a", expiresAt = 1_800_000_000) {
  return JSON.stringify({
    access_token: testAccessToken({ sub: subject, exp: expiresAt }),
    refresh_token: "refresh",
    expires_at: expiresAt,
    user,
  });
}

describe("saved sign-in identity", () => {
  it("uses the stored profile when it belongs to the account in the OS credential store", () => {
    const user = { id: "user-a", email: "a@example.com", app_metadata: { provider: "google" }, user_metadata: { name: "A" } };
    const resolved = resolveSavedSignInUser({
      nativeAccessToken: testAccessToken({ sub: "user-a", email: "a@example.com" }),
      storedSession: parseStoredAuthSession(storedSession(user)),
    });
    expect(resolved).toMatchObject(user);
  });

  it("follows the OS credential store when the WebView copy belongs to another account", () => {
    const resolved = resolveSavedSignInUser({
      nativeAccessToken: testAccessToken({ sub: "user-b", email: "b@example.com", is_anonymous: false }),
      storedSession: parseStoredAuthSession(storedSession({ id: "user-a", email: "a@example.com" })),
    });
    expect(resolved).toMatchObject({ id: "user-b", email: "b@example.com", is_anonymous: false });
  });

  it("keeps an anonymous claim so required sign-in still rejects it", () => {
    const resolved = resolveSavedSignInUser({
      nativeAccessToken: testAccessToken({ sub: "user-c", is_anonymous: true }),
      storedSession: null,
    });
    expect(resolved).toMatchObject({ id: "user-c", is_anonymous: true });
  });

  it("uses the WebView copy outside the desktop shell and finds no account without one", () => {
    expect(resolveSavedSignInUser({ storedSession: parseStoredAuthSession(storedSession({ id: "user-a" })) })?.id).toBe("user-a");
    expect(resolveSavedSignInUser({ storedSession: null })).toBeNull();
    expect(resolveSavedSignInUser({ nativeAccessToken: "not-a-jwt", storedSession: null })).toBeNull();
  });

  it("ignores a stored profile whose id does not match its own token", () => {
    const snapshot = parseStoredAuthSession(storedSession({ id: "user-x" }, "user-a"));
    expect(snapshot?.user).toBeNull();
    expect(snapshot?.accessTokenSubject).toBe("user-a");
  });

  it("treats a missing or malformed stored session as absent and its expiry as passed", () => {
    expect(parseStoredAuthSession(null)).toBeNull();
    expect(parseStoredAuthSession("{")).toBeNull();
    expect(parseStoredAuthSession(JSON.stringify({ access_token: "a" }))).toBeNull();
    const now = 1_800_000_000_000;
    expect(isStoredAuthSessionExpired(parseStoredAuthSession(storedSession(null, "user-a", now / 1000 - 1)), now)).toBe(true);
    expect(isStoredAuthSessionExpired(parseStoredAuthSession(storedSession(null, "user-a", now / 1000 + 60)), now)).toBe(false);
    expect(isStoredAuthSessionExpired(null, now)).toBe(true);
  });
});

describe("auth server reachability", () => {
  it.each([
    ["a failed fetch", Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 })],
    ["a gateway error", Object.assign(new Error("Bad gateway"), { name: "AuthRetryableFetchError", status: 502 })],
    ["a server error", Object.assign(new Error("Internal"), { name: "AuthApiError", status: 500 })],
    ["a non-JSON proxy page", Object.assign(new Error("Unexpected token <"), { name: "AuthUnknownError" })],
    ["a raw network TypeError", new TypeError("Load failed")],
    ["a timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" })],
  ])("treats %s as unreachable", (_label, error) => {
    expect(isAuthServerUnreachableError(error)).toBe(true);
  });

  it.each([
    ["an invalid refresh token", Object.assign(new Error("Invalid Refresh Token"), { name: "AuthApiError", status: 400 })],
    ["a deleted user", Object.assign(new Error("User not found"), { name: "AuthApiError", status: 404 })],
    ["a missing session", Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError", status: 400 })],
    ["no error", null],
  ])("treats %s as an answer from the server", (_label, error) => {
    expect(isAuthServerUnreachableError(error)).toBe(false);
  });
});
