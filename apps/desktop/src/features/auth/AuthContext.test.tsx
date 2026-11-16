// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const GOOGLE_OAUTH_CHALLENGE = "a".repeat(43);

function googleOAuthUrl(extraParams: Record<string, string> = {}) {
  const url = new URL("https://project.supabase.co/auth/v1/authorize");
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", "https://drifty.so/auth/desktop-google-callback/");
  url.searchParams.set("code_challenge", GOOGLE_OAUTH_CHALLENGE);
  url.searchParams.set("code_challenge_method", "s256");
  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

const {
  authMocks,
  getSession,
  onAuthStateChange,
  exchangeCodeForSession,
  exchangeGoogleOAuthCodeForSession,
  setSession,
  signInAnonymously,
  signInWithIdToken,
  signInWithOAuth,
  activateGoogleOAuthVerifier,
  clearGoogleOAuthVerifier,
  hasUsableGoogleOAuthVerifier,
  signInWithPassword,
  signUp,
  resetPasswordForEmail,
  updateUser,
  signOut,
  invoke,
} = vi.hoisted(() => {
  const mocks = {
    authChangeHandler: null as ((event: string, session: Session | null) => void) | null,
  };

  return {
    authMocks: mocks,
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn((handler: (event: string, session: Session | null) => void) => {
      mocks.authChangeHandler = handler;
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      };
    }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
    exchangeGoogleOAuthCodeForSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    setSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInAnonymously: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
    signInWithIdToken: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: "https://project.supabase.co/auth/v1/authorize?provider=google" }, error: null }),
    activateGoogleOAuthVerifier: vi.fn(),
    clearGoogleOAuthVerifier: vi.fn(() => true),
    hasUsableGoogleOAuthVerifier: vi.fn(() => true),
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    invoke: vi.fn().mockResolvedValue([]),
  };
});

const supabaseConfig = vi.hoisted(() => ({
  authModePolicy: {
    mode: "optional" as "optional" | "required",
    isAuthRequired: false,
    allowsAnonymousAuth: true,
  },
  hasBlockingAuthConfigurationError: false,
}));

const tauriMocks = vi.hoisted(() => {
  let openUrlHandler: ((urls: string[]) => void) | null = null;

  return {
    openUrl: vi.fn().mockResolvedValue(undefined),
    getCurrent: vi.fn().mockResolvedValue(null),
    onOpenUrl: vi.fn((handler: (urls: string[]) => void) => {
      openUrlHandler = handler;
      return Promise.resolve(vi.fn());
    }),
    emitOpenUrl: (urls: string[]) => {
      openUrlHandler?.(urls);
    },
    resetOpenUrlHandler: () => {
      openUrlHandler = null;
    },
  };
});

vi.mock("../../lib/supabase/client", () => ({
  authModePolicy: supabaseConfig.authModePolicy,
  clearGoogleOAuthVerifier,
  exchangeGoogleOAuthCodeForSession,
  getGoogleOAuthAuthorizeUrl: () => "https://project.supabase.co/auth/v1/authorize",
  hasBlockingAuthConfigurationError: () => supabaseConfig.hasBlockingAuthConfigurationError,
  hasUsableGoogleOAuthVerifier,
  prepareGoogleOAuthAuthorization: async (options: {
    redirectTo: string;
    skipBrowserRedirect: true;
    queryParams: Record<string, string>;
  }) => {
    const response = await signInWithOAuth({ provider: "google", options });
    return { ...response, activateVerifier: activateGoogleOAuthVerifier };
  },
  supabase: {
    auth: {
      getSession,
      onAuthStateChange,
      exchangeCodeForSession,
      setSession,
      signInAnonymously,
      signInWithIdToken,
      signInWithOAuth,
      signOut,
      signInWithPassword,
      signUp,
      resetPasswordForEmail,
      updateUser,
    },
  },
  isSupabaseEnabled: () => true,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: tauriMocks.openUrl,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: tauriMocks.getCurrent,
  onOpenUrl: tauriMocks.onOpenUrl,
}));

import {
  AuthProvider,
  GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS,
  GOOGLE_OAUTH_OPERATION_TIMEOUT_MS,
  hasRequiredAccountAuth,
  isAnonymousSupabaseUser,
  useAuth,
} from "./AuthContext";
import { clearAuthDiagnostics, readAuthDiagnostics } from "./authDiagnostics";

function CaptureAuth({ onReady }: { onReady: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();

  useEffect(() => {
    onReady(auth);
  }, [auth, onReady]);

  return null;
}

function createSession({
  isAnonymous = false,
  email,
}: {
  isAnonymous?: boolean;
  email?: string;
} = {}): Session {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "user-id",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
      is_anonymous: isAnonymous,
      email,
    },
  } as Session;
}

function requireCapturedAuth(auth: ReturnType<typeof useAuth> | null): ReturnType<typeof useAuth> {
  if (!auth) {
    throw new Error("Auth state was not captured.");
  }
  return auth;
}

const SAVED_ACCOUNT_EMAIL = "person@example.com";

function testAccessToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

function authServerUnreachableError(): Error {
  return Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 });
}

function authServerRejectionError(): Error {
  return Object.assign(new Error("Invalid Refresh Token: Refresh Token Not Found"), { name: "AuthApiError", status: 400 });
}

function expiredAt(): number {
  return Math.floor(Date.now() / 1000) - 3 * 60 * 60;
}

function storeSavedWebViewSession(expiresAt = expiredAt()) {
  window.localStorage.setItem("drifty.desktop.auth", JSON.stringify({
    access_token: testAccessToken({ sub: "user-id", email: SAVED_ACCOUNT_EMAIL, exp: expiresAt }),
    refresh_token: "stored-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id: "user-id",
      email: SAVED_ACCOUNT_EMAIL,
      aud: "authenticated",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-09-01T00:00:00.000Z",
      is_anonymous: false,
    },
  }));
}

function mockNativeSavedSession() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  invoke.mockImplementation(async (command: string) => {
    if (command === "auth_take_pending_deep_links") return [];
    if (command === "auth_load_saved_session") {
      return JSON.stringify({
        accessToken: testAccessToken({ sub: "user-id", email: SAVED_ACCOUNT_EMAIL, exp: expiredAt(), is_anonymous: false }),
        refreshToken: "saved-refresh",
      });
    }
    return undefined;
  });
}

function renderCapturedAuth() {
  const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
  render(
    <AuthProvider>
      <CaptureAuth onReady={(value) => { latestAuth.current = value; }} />
    </AuthProvider>
  );
  return latestAuth;
}

async function expectSavedSignInPending(latestAuth: { current: ReturnType<typeof useAuth> | null }) {
  await waitFor(() => {
    expect(latestAuth.current?.isSavedSignInPending).toBe(true);
  });
  const auth = requireCapturedAuth(latestAuth.current);
  expect(auth.status).toBe("authenticated");
  expect(auth.user?.id).toBe("user-id");
  expect(auth.user?.email).toBe(SAVED_ACCOUNT_EMAIL);
  expect(auth.hasRequiredAccountAuth).toBe(true);
  expect(auth.session).toBeNull();
  expect(auth.cloudConnectionStatus).toBe("offline");
}

describe("AuthContext", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
    exchangeCodeForSession.mockResolvedValue({ error: null });
    exchangeGoogleOAuthCodeForSession.mockResolvedValue({ data: { session: null }, error: null });
    setSession.mockResolvedValue({ data: { session: null }, error: null });
    signInWithOAuth.mockResolvedValue({ data: { url: googleOAuthUrl() }, error: null });
    signInWithIdToken.mockResolvedValue({ data: { session: null, user: null }, error: null });
    clearGoogleOAuthVerifier.mockReturnValue(true);
    hasUsableGoogleOAuthVerifier.mockReturnValue(true);
    signInWithPassword.mockResolvedValue({ data: {}, error: null });
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    updateUser.mockResolvedValue({ data: { user: null }, error: null });
    signOut.mockResolvedValue({ error: null });
    invoke.mockResolvedValue([]);
    authMocks.authChangeHandler = null;
    tauriMocks.getCurrent.mockResolvedValue(null);
    tauriMocks.openUrl.mockResolvedValue(undefined);
    tauriMocks.resetOpenUrlHandler();
    supabaseConfig.authModePolicy.mode = "optional";
    supabaseConfig.authModePolicy.isAuthRequired = false;
    supabaseConfig.authModePolicy.allowsAnonymousAuth = true;
    supabaseConfig.hasBlockingAuthConfigurationError = false;
    clearAuthDiagnostics({ mirrorToConsole: false });
    window.history.replaceState({}, "", "/");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearAuthDiagnostics({ mirrorToConsole: false });
    window.history.replaceState({}, "", "/");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("identifies Supabase anonymous users as insufficient for required account auth", () => {
    const anonymousSession = createSession({ isAnonymous: true });
    const accountSession = createSession();

    expect(isAnonymousSupabaseUser(anonymousSession.user)).toBe(true);
    expect(hasRequiredAccountAuth(anonymousSession.user)).toBe(false);
    expect(isAnonymousSupabaseUser(accountSession.user)).toBe(false);
    expect(hasRequiredAccountAuth(accountSession.user)).toBe(true);
    expect(hasRequiredAccountAuth(null)).toBe(false);
  });

  it("opens the website login in Tauri builds", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    await act(async () => {
      await authApi!.signInWithWebsite();
    });

    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://drifty.so/auth/login/");
    expect(invoke).not.toHaveBeenCalledWith("auth_exit_for_browser_sign_in");
    await waitFor(() => {
      expect(authApi?.callbackStatus?.message).toBe("Browser opened.");
    });
  });

  it("opens the Drifty website login in Tauri builds", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    await act(async () => {
      await authApi!.signInWithWebsite();
    });

    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://drifty.so/auth/login/");
    await waitFor(() => {
      expect(authApi?.callbackStatus?.message).toBe("Browser opened.");
    });
  });

  it("starts direct Google OAuth in Tauri builds", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    const auth = requireCapturedAuth(authApi);

    let googleError: Error | null | undefined;
    await act(async () => {
      googleError = (await auth.signInWithGoogle()).error;
    });

    expect(googleError).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://drifty.so/auth/desktop-google-callback/",
        skipBrowserRedirect: true,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    expect(tauriMocks.openUrl).toHaveBeenCalledWith(googleOAuthUrl());
    expect(activateGoogleOAuthVerifier).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).not.toHaveBeenCalledWith("https://drifty.so/auth/login/");
    await waitFor(() => {
      expect(authApi?.callbackStatus?.message).toBe("Browser opened. Waiting for sign-in to return to Drifty.");
    });
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it("uses the isolated native Calendar flow only for opted-in onboarding", async () => {
    vi.stubEnv("VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED", "1");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    session.user.identities = [{
      id: "identity-id",
      identity_id: "identity-id",
      user_id: session.user.id,
      identity_data: { sub: "google-subject" },
      provider: "google",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
    }];
    signInWithIdToken.mockResolvedValue({ data: { session, user: session.user }, error: null });
    invoke.mockImplementation(async (command: string) => {
      if (command === "google_calendar_capability") return { configured: true };
      if (command === "google_calendar_authorize") {
        return {
          attemptId: "attempt-id",
          purpose: "signIn",
          calendarGranted: true,
          calendarCredentialReady: true,
          connectedEmail: "person@example.com",
          googleSubject: "google-subject",
          idToken: "google-id-token",
          accessToken: "google-access-token",
        };
      }
      if (command === "google_calendar_finalize") {
        return {
          configured: true,
          connected: true,
          connectedEmail: "person@example.com",
          grantedScopes: ["openid", "https://www.googleapis.com/auth/calendar.events.owned.readonly"],
        };
      }
      return command === "auth_load_saved_session" ? null : [];
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>,
    );
    await waitFor(() => expect(authApi).not.toBeNull());

    let result: { error: Error | null } | undefined;
    await act(async () => {
      result = await authApi!.signInWithGoogle({ requestCalendar: true });
    });

    expect(result?.error).toBeNull();
    expect(signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-id-token",
      access_token: "google-access-token",
    });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("google_calendar_finalize", {
      userId: "user-id",
      attemptId: "attempt-id",
      purpose: "signIn",
    });
    expect(requireCapturedAuth(authApi).callbackStatus?.message).toBe(
      "Signed in. Google Calendar is connected.",
    );
  });

  it("fails closed instead of opening another OAuth flow when Google identities do not match", async () => {
    vi.stubEnv("VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED", "1");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    session.user.identities = [{
      id: "identity-id",
      identity_id: "identity-id",
      user_id: session.user.id,
      identity_data: { sub: "different-google-subject" },
      provider: "google",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
    }];
    signInWithIdToken.mockResolvedValue({ data: { session, user: session.user }, error: null });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_load_saved_session") return null;
      if (command === "google_calendar_capability") return { configured: true };
      if (command === "google_calendar_authorize") {
        return {
          attemptId: "attempt-id",
          purpose: "signIn",
          calendarGranted: true,
          calendarCredentialReady: true,
          connectedEmail: "person@example.com",
          googleSubject: "expected-google-subject",
          idToken: "google-id-token",
          accessToken: "google-access-token",
        };
      }
      return [];
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>,
    );
    await waitFor(() => expect(authApi).not.toBeNull());

    let result: { error: Error | null } | undefined;
    await act(async () => {
      result = await authApi!.signInWithGoogle({ requestCalendar: true });
    });

    expect(result?.error?.message).toBe("Google sign-in could not be verified. Please try again.");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("google_calendar_discard_pending", {
      attemptId: "attempt-id",
    });
    expect(requireCapturedAuth(authApi)).toMatchObject({
      status: "unauthenticated",
      user: null,
      callbackStatus: {
        phase: "failed",
        googleAction: "retry",
      },
    });
  });

  it("keeps Calendar cancellation from opening a second Google consent flow", async () => {
    vi.stubEnv("VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED", "1");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invoke.mockImplementation(async (command: string) => {
      if (command === "google_calendar_capability") return { configured: true };
      if (command === "google_calendar_authorize") {
        throw new Error("GOOGLE_CALENDAR_AUTHORIZATION_CANCELLED");
      }
      return command === "auth_load_saved_session" ? null : [];
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>,
    );
    await waitFor(() => expect(authApi).not.toBeNull());

    let result: { error: Error | null } | undefined;
    await act(async () => {
      result = await authApi!.signInWithGoogle({ requestCalendar: true });
    });

    expect(result?.error?.message).toMatch(/cancelled/i);
    expect(signInWithIdToken).not.toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      googleAction: "retry",
    });
  });

  it("reopens the active Google OAuth URL without creating a second PKCE flow", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    await act(async () => {
      await authApi!.signInWithGoogle();
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(activateGoogleOAuthVerifier).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(2);
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(1, googleOAuthUrl());
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(2, googleOAuthUrl());
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it("starts a fresh Google flow instead of reopening when the persisted verifier is missing", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    signInWithOAuth
      .mockResolvedValueOnce({
        data: { url: googleOAuthUrl({ attempt: "first" }) },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { url: googleOAuthUrl({ attempt: "fresh" }) },
        error: null,
      });
    hasUsableGoogleOAuthVerifier.mockReturnValueOnce(false);
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    await act(async () => {
      await authApi!.signInWithGoogle();
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
    expect(activateGoogleOAuthVerifier).toHaveBeenCalledTimes(2);
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(
      1,
      googleOAuthUrl({ attempt: "first" }),
    );
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(
      2,
      googleOAuthUrl({ attempt: "fresh" }),
    );
    expect(clearGoogleOAuthVerifier).toHaveBeenCalled();
  });

  it("expires an unanswered Google OAuth handoff and allows a fresh attempt", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      await authApi!.signInWithGoogle();
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS);
    });

    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      message: "Google sign-in expired after 5 minutes. Try again.",
      method: "google",
      googleAction: "retry",
    });

    await act(async () => {
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(2);
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it("reopens just before the handoff boundary and creates a fresh flow at expiry", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      await authApi!.signInWithGoogle();
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS - 1);
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(2);
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(3);
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it("starts a full five-minute handoff window after a slow PKCE preparation", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let resolvePreparation: ((value: {
      data: { url: string };
      error: null;
    }) => void) | null = null;
    signInWithOAuth.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePreparation = resolve;
    }));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      const pendingAttempt = authApi!.signInWithGoogle();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
      resolvePreparation?.({
        data: { url: googleOAuthUrl({ attempt: "slow" }) },
        error: null,
      });
      await pendingAttempt;
    });

    expect(activateGoogleOAuthVerifier).toHaveBeenCalledWith(Date.now() + GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS - 1);
      await authApi!.signInWithGoogle();
    });
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await authApi!.signInWithGoogle();
    });
    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
  });

  it("times out a hung PKCE request, releases the lock, and allows a fresh attempt", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    signInWithOAuth.mockImplementationOnce(() => new Promise(() => undefined));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    let firstError: Error | null | undefined;
    await act(async () => {
      const firstAttempt = authApi!.signInWithGoogle();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_OPERATION_TIMEOUT_MS);
      firstError = (await firstAttempt).error;
    });

    expect(firstError?.message).toBe("Google sign-in took too long. Try again, or continue with email.");
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      method: "google",
      googleAction: "retry",
    });
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
    expect(activateGoogleOAuthVerifier).not.toHaveBeenCalled();

    await act(async () => {
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(1);
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it.each([
    ["callback notice dismissal", async (auth: ReturnType<typeof useAuth>) => auth.clearCallbackStatus()],
    ["email sign-in", async (auth: ReturnType<typeof useAuth>) => auth.signInWithEmail("person@example.com", "password12345")],
    ["sign-out", async (auth: ReturnType<typeof useAuth>) => auth.signOut()],
  ])("ignores a PKCE preparation that settles after pending cancellation by %s", async (_name, cancelPending) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let resolveFirstPreparation: ((value: {
      data: { url: string };
      error: null;
    }) => void) | null = null;
    signInWithOAuth.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstPreparation = resolve;
    }));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    let pendingAttempt: Promise<{ error: Error | null }> | null = null;
    await act(async () => {
      pendingAttempt = authApi!.signInWithGoogle();
      await Promise.resolve();
      await cancelPending(authApi!);
      await pendingAttempt;
    });

    await act(async () => {
      resolveFirstPreparation?.({
        data: { url: googleOAuthUrl({ attempt: "cancelled" }) },
        error: null,
      });
      await Promise.resolve();
    });

    expect(activateGoogleOAuthVerifier).not.toHaveBeenCalled();
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
    expect(activateGoogleOAuthVerifier).not.toHaveBeenCalled();
    expect(requireCapturedAuth(authApi).callbackStatus).toBeNull();
  });

  it("keeps a late timed-out PKCE preparation isolated from a fresh retry", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let resolveFirstPreparation: ((value: {
      data: { url: string };
      error: null;
    }) => void) | null = null;
    signInWithOAuth.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstPreparation = resolve;
    }));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      const timedOutAttempt = authApi!.signInWithGoogle();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_OPERATION_TIMEOUT_MS);
      await timedOutAttempt;
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
    expect(activateGoogleOAuthVerifier).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstPreparation?.({
        data: { url: googleOAuthUrl({ attempt: "stale" }) },
        error: null,
      });
      await Promise.resolve();
    });

    expect(activateGoogleOAuthVerifier).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(1);
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "waiting",
      googleAction: "reopen",
    });
  });

  it("ignores a pending PKCE preparation that settles after provider unmount", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let resolveFirstPreparation: ((value: {
      data: { url: string };
      error: null;
    }) => void) | null = null;
    signInWithOAuth.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstPreparation = resolve;
    }));
    let authApi: ReturnType<typeof useAuth> | null = null;
    const view = render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    let pendingAttempt: Promise<{ error: Error | null }> | null = null;
    await act(async () => {
      pendingAttempt = authApi!.signInWithGoogle();
      await Promise.resolve();
    });
    view.unmount();

    await act(async () => {
      await pendingAttempt;
      resolveFirstPreparation?.({
        data: { url: googleOAuthUrl({ attempt: "unmounted" }) },
        error: null,
      });
      await Promise.resolve();
    });

    expect(activateGoogleOAuthVerifier).not.toHaveBeenCalled();
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
  });

  it("cancels the Google OAuth expiry timer when a callback is received", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    exchangeGoogleOAuthCodeForSession.mockResolvedValueOnce({ data: { session }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      await authApi!.signInWithGoogle();
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=completed-before-timeout"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exchangeGoogleOAuthCodeForSession).toHaveBeenCalledWith(
      "completed-before-timeout",
      expect.any(AbortSignal),
    );
    expect(requireCapturedAuth(authApi).callbackStatus?.phase).toBe("completed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS);
    });

    expect(requireCapturedAuth(authApi).callbackStatus?.phase).toBe("completed");
  });

  it("times out a hung Google code exchange and keeps a late result from reviving the callback UI", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    let resolveExchange: ((value: { data: { session: Session }; error: null }) => void) | null = null;
    exchangeGoogleOAuthCodeForSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveExchange = resolve;
    }));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      await authApi!.signInWithGoogle();
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=hung-exchange"]);
      await Promise.resolve();
    });
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "exchanging",
      method: "google",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_OPERATION_TIMEOUT_MS);
    });
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      message: "Google sign-in took too long. Try again, or continue with email.",
      method: "google",
      googleAction: "retry",
    });

    await act(async () => {
      resolveExchange?.({ data: { session }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      googleAction: "retry",
    });

    await act(async () => {
      await authApi!.signInWithGoogle();
    });
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps the current Google handoff available when a stale callback code fails", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    exchangeGoogleOAuthCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error("Google sign-in could not be completed. Try again."),
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    await act(async () => {
      await authApi!.signInWithGoogle();
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=stale-code"]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requireCapturedAuth(authApi).callbackStatus?.phase).toBe("failed");

    await act(async () => {
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(1, googleOAuthUrl());
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(2, googleOAuthUrl());
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "waiting",
      googleAction: "reopen",
    });
  });

  it.each([
    ["email sign-in", async (auth: ReturnType<typeof useAuth>) => auth.signInWithEmail("person@example.com", "password12345")],
    ["callback notice dismissal", async (auth: ReturnType<typeof useAuth>) => auth.clearCallbackStatus()],
    ["sign-out", async (auth: ReturnType<typeof useAuth>) => auth.signOut()],
  ])("aborts an in-flight Google code exchange after %s", async (_name, cancelExchange) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let exchangeSignal: AbortSignal | null = null;
    exchangeGoogleOAuthCodeForSession.mockImplementationOnce((_code, signal: AbortSignal) => {
      exchangeSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    await act(async () => {
      await authApi!.signInWithGoogle();
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=cancel-in-flight"]);
      await Promise.resolve();
    });
    expect(requireCapturedAuth(authApi).callbackStatus?.phase).toBe("exchanging");

    await act(async () => {
      await cancelExchange(authApi!);
      await Promise.resolve();
    });

    expect((exchangeSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(requireCapturedAuth(authApi).callbackStatus).toBeNull();
  });

  it("aborts an in-flight Google code exchange when the provider unmounts", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let exchangeSignal: AbortSignal | null = null;
    exchangeGoogleOAuthCodeForSession.mockImplementationOnce((_code, signal: AbortSignal) => {
      exchangeSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    let authApi: ReturnType<typeof useAuth> | null = null;
    const view = render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    await act(async () => {
      await authApi!.signInWithGoogle();
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=unmount-in-flight"]);
      await Promise.resolve();
    });

    view.unmount();
    expect((exchangeSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it.each(["TOKEN_REFRESHED", "USER_UPDATED"])(
    "keeps the active Google handoff through a background %s auth event",
    async (eventType) => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
      const refreshedSession = createSession();
      const callbackSession = createSession();
      callbackSession.user.id = "google-callback-user";
      exchangeGoogleOAuthCodeForSession.mockResolvedValueOnce({
        data: { session: callbackSession },
        error: null,
      });
      let authApi: ReturnType<typeof useAuth> | null = null;

      render(
        <AuthProvider>
          <CaptureAuth onReady={(value) => {
            authApi = value;
          }} />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(authApi).not.toBeNull();
        expect(authMocks.authChangeHandler).not.toBeNull();
      });
      await act(async () => {
        await authApi!.signInWithGoogle();
      });
      const verifierClearCount = clearGoogleOAuthVerifier.mock.calls.length;

      act(() => {
        authMocks.authChangeHandler?.(eventType, refreshedSession);
      });
      expect(clearGoogleOAuthVerifier).toHaveBeenCalledTimes(verifierClearCount);

      await act(async () => {
        tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=after-background-event"]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(exchangeGoogleOAuthCodeForSession).toHaveBeenCalledWith(
        "after-background-event",
        expect.any(AbortSignal),
      );
      expect(requireCapturedAuth(authApi).callbackStatus?.phase).toBe("completed");
      expect(requireCapturedAuth(authApi).user?.id).toBe("google-callback-user");
    },
  );

  it.each([
    ["email sign-in", async (auth: ReturnType<typeof useAuth>) => auth.signInWithEmail("person@example.com", "password12345")],
    ["callback notice dismissal", async (auth: ReturnType<typeof useAuth>) => auth.clearCallbackStatus()],
    ["sign-out", async (auth: ReturnType<typeof useAuth>) => auth.signOut()],
  ])("cancels the Google OAuth expiry timer after %s", async (_name, cancelAttempt) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      await authApi!.signInWithGoogle();
      await cancelAttempt(authApi!);
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS);
    });

    expect(requireCapturedAuth(authApi).callbackStatus).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["email sign-in", async (auth: ReturnType<typeof useAuth>) => auth.signInWithEmail("person@example.com", "password12345")],
    ["callback notice dismissal", async (auth: ReturnType<typeof useAuth>) => auth.clearCallbackStatus()],
    ["sign-out", async (auth: ReturnType<typeof useAuth>) => auth.signOut()],
  ])("rejects a late Google callback after active-attempt cancellation by %s", async (_name, cancelAttempt) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    await act(async () => {
      await authApi!.signInWithGoogle();
      await cancelAttempt(authApi!);
    });
    hasUsableGoogleOAuthVerifier.mockReturnValue(false);

    await act(async () => {
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=late-after-cancel"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(exchangeGoogleOAuthCodeForSession).not.toHaveBeenCalled();
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      message: "That Google sign-in attempt expired or was cancelled. Start Google sign-in again.",
    });
    expect(clearGoogleOAuthVerifier).toHaveBeenCalled();
  });

  it("redacts a hostile Supabase code-exchange error from callback UI", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    exchangeGoogleOAuthCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error("SECRET_TOKEN=do-not-reflect"),
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    await act(async () => {
      await authApi!.signInWithGoogle();
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=hostile-error"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requireCapturedAuth(authApi).callbackStatus?.message).toBe("Google sign-in could not be completed. Try again.");
    expect(requireCapturedAuth(authApi).callbackStatus?.message).not.toContain("SECRET_TOKEN");
  });

  it("cancels the Google OAuth expiry timer when the provider unmounts", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;
    vi.useFakeTimers();

    const view = render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(authApi).not.toBeNull();
    const baselineTimerCount = vi.getTimerCount();

    await act(async () => {
      await authApi!.signInWithGoogle();
    });
    const timerCountWithAttempt = vi.getTimerCount();
    expect(timerCountWithAttempt).toBeGreaterThan(baselineTimerCount);

    view.unmount();
    expect(vi.getTimerCount()).toBeLessThan(timerCountWithAttempt);
  });

  it("keeps repeated cancellation idempotent without reviving stale OAuth state", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    await act(async () => {
      await authApi!.signInWithGoogle();
      authApi!.clearCallbackStatus();
      authApi!.clearCallbackStatus();
      await authApi!.signOut();
      await authApi!.signOut();
      authApi!.clearCallbackStatus();
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS * 2);
    });

    expect(requireCapturedAuth(authApi).callbackStatus).toBeNull();
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(2);

    await act(async () => {
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(2);
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it("returns explicit fallback guidance when the Google browser handoff fails", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    tauriMocks.openUrl.mockRejectedValueOnce(new Error("opener denied"));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    const auth = requireCapturedAuth(authApi);

    let googleError: Error | null | undefined;
    await act(async () => {
      googleError = (await auth.signInWithGoogle()).error;
    });

    expect(googleError?.message).toBe("Unable to open Google sign-in. Try again, or continue with email.");
    expect(tauriMocks.openUrl).toHaveBeenCalledWith(googleOAuthUrl());
    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });
    expect(requireCapturedAuth(authApi).callbackStatus?.message).toBe("Unable to open Google sign-in. Try again, or continue with email.");
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it("times out a hung native opener, releases the lock, and reopens the same flow", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    tauriMocks.openUrl.mockImplementationOnce(() => new Promise(() => undefined));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });
    vi.useFakeTimers();

    let firstError: Error | null | undefined;
    await act(async () => {
      const firstAttempt = authApi!.signInWithGoogle();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(GOOGLE_OAUTH_OPERATION_TIMEOUT_MS);
      firstError = (await firstAttempt).error;
    });

    expect(firstError?.message).toBe("Unable to open Google sign-in. Try again, or continue with email.");
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      method: "google",
      googleAction: "reopen",
    });
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await authApi!.signInWithGoogle();
    });

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(2);
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(1, googleOAuthUrl());
    expect(tauriMocks.openUrl).toHaveBeenNthCalledWith(2, googleOAuthUrl());
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("reopen");
  });

  it("does not revive Google status when a pending native opener settles after repeated dismissal", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let resolveOpen: (() => void) | null = null;
    tauriMocks.openUrl.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveOpen = resolve;
    }));
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    let pendingAttempt: Promise<{ error: Error | null }> | null = null;
    await act(async () => {
      pendingAttempt = authApi!.signInWithGoogle();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(tauriMocks.openUrl).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      authApi!.clearCallbackStatus();
      authApi!.clearCallbackStatus();
      await pendingAttempt;
    });

    await act(async () => {
      resolveOpen?.();
      await Promise.resolve();
    });

    expect(activateGoogleOAuthVerifier).toHaveBeenCalledTimes(1);
    expect(tauriMocks.openUrl).toHaveBeenCalledTimes(1);
    expect(requireCapturedAuth(authApi).callbackStatus).toBeNull();
    expect(readAuthDiagnostics().some((entry) => entry.event === "auth.google_oauth.opened")).toBe(false);
  });

  it("rejects short signup passwords before calling Supabase", async () => {
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    const result = await authApi!.signUpWithEmail("person@example.com", "short");

    expect(result.needsEmailConfirmation).toBe(false);
    expect(result.error?.message).toMatch(/at least 12 characters/i);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("normalizes Supabase weak-password signup errors", async () => {
    let authApi: ReturnType<typeof useAuth> | null = null;
    const weakPasswordError = Object.assign(new Error("Password should be at least 12 characters"), {
      code: "weak_password",
    });
    signUp.mockResolvedValue({ data: { session: null }, error: weakPasswordError });

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    const result = await authApi!.signUpWithEmail("person@example.com", "long-enough1");

    expect(signUp).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "long-enough1",
      options: {
        emailRedirectTo: "https://drifty.so/auth/callback/",
        // Supabase Auth emails choose Korean or English from this.
        data: { locale: "en" },
      },
    });
    expect(result.error?.message).toMatch(/at least 12 characters/i);
    expect(result.needsEmailConfirmation).toBe(false);
  });

  it("creates an email account through Supabase and reports confirmation when no session is returned", async () => {
    let authApi: ReturnType<typeof useAuth> | null = null;
    signUp.mockResolvedValue({ data: { session: null }, error: null });

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    const result = await authApi!.signUpWithEmail("person@example.com", "long-enough1");

    expect(signUp).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "long-enough1",
      options: {
        emailRedirectTo: "https://drifty.so/auth/callback/",
        // Supabase Auth emails choose Korean or English from this.
        data: { locale: "en" },
      },
    });
    expect(result.error).toBeNull();
    expect(result.needsEmailConfirmation).toBe(true);
  });

  it("returns an error when direct Google OAuth does not return a URL", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    let googleError: Error | null | undefined;
    await act(async () => {
      googleError = (await authApi!.signInWithGoogle()).error;
    });

    expect(googleError?.message).toBe("Google sign-in did not return an OAuth URL.");
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });
    expect(authApi!.callbackStatus?.message).toBe("Google sign-in did not return an OAuth URL.");
  });

  it("rejects a malformed Google OAuth URL without opening or reflecting it", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    signInWithOAuth.mockResolvedValueOnce({ data: { url: "javascript:alert(document.cookie)" }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    let googleError: Error | null | undefined;
    await act(async () => {
      googleError = (await authApi!.signInWithGoogle()).error;
    });

    expect(googleError?.message).toBe("Google sign-in returned an invalid OAuth URL. Try again.");
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "failed",
      message: "Google sign-in returned an invalid OAuth URL. Try again.",
      method: "google",
      googleAction: "retry",
    });
    expect(JSON.stringify(readAuthDiagnostics())).not.toContain("document.cookie");
  });

  it.each([
    ["structurally malformed", "https://[invalid"],
    ["plain HTTP", "http://project.supabase.co/auth/v1/authorize"],
    ["unrelated HTTPS origin", "https://example.com/auth/v1/authorize"],
    ["wrong authorize path", "https://project.supabase.co/auth/v1/token"],
    ["credential-bearing", "https://user:secret@project.supabase.co/auth/v1/authorize"],
    ["wrong provider", googleOAuthUrl({ provider: "github" })],
    ["wrong callback bridge", googleOAuthUrl({ redirect_to: "https://example.com/callback" })],
    ["missing challenge", googleOAuthUrl({ code_challenge: "" })],
    ["wrong challenge method", googleOAuthUrl({ code_challenge_method: "plain" })],
    ["duplicate critical parameter", `${googleOAuthUrl()}&provider=google`],
    ["fragment-bearing", `${googleOAuthUrl()}#unexpected`],
    ["oversized", `https://project.supabase.co/auth/v1/authorize?state=${"a".repeat(8_192)}`],
    ["wrong-shape", { href: "https://project.supabase.co/auth/v1/authorize" }],
  ])("rejects a %s OAuth URL without opening or reflecting it", async (_name, untrustedUrl) => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    signInWithOAuth.mockResolvedValueOnce({ data: { url: untrustedUrl }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    let result: { error: Error | null } | undefined;
    await act(async () => {
      result = await authApi!.signInWithGoogle();
    });

    expect(result?.error?.message).toBe("Google sign-in returned an invalid OAuth URL. Try again.");
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
    expect(requireCapturedAuth(authApi).callbackStatus?.googleAction).toBe("retry");
    const diagnostics = JSON.stringify(readAuthDiagnostics());
    expect(diagnostics).not.toContain("user:secret");
    expect(diagnostics).not.toContain("example.com");
    expect(diagnostics.length).toBeLessThan(20_000);
  });

  it("redacts the Supabase error when direct Google OAuth preparation fails", async () => {
    const oauthError = new Error("Google provider is disabled");
    signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: oauthError });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi).not.toBeNull();
    });

    let googleError: Error | null | undefined;
    await act(async () => {
      googleError = (await authApi!.signInWithGoogle()).error;
    });

    expect(googleError?.message).toBe("Unable to start Google sign-in. Try again, or continue with email.");
    expect(googleError?.message).not.toContain(oauthError.message);
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });
    expect(authApi!.callbackStatus?.message).toBe("Unable to start Google sign-in. Try again, or continue with email.");
  });

  it("exchanges startup Tauri deep-link auth codes", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    exchangeCodeForSession.mockResolvedValueOnce({ data: { session }, error: null });
    tauriMocks.getCurrent.mockResolvedValueOnce([
      "drifty://auth/callback?code=startup-code",
      "drifty://settings?code=ignored",
      "not a valid url",
    ]);
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("startup-code");
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("completed");
    });
  });

  it("keeps website PKCE callbacks working without Google attempt metadata", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    hasUsableGoogleOAuthVerifier.mockReturnValue(false);
    exchangeCodeForSession.mockResolvedValueOnce({ data: { session }, error: null });
    tauriMocks.getCurrent.mockResolvedValueOnce([
      "drifty://auth/callback?code=email-confirmation-code",
    ]);
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("email-confirmation-code");
    });
    expect(hasUsableGoogleOAuthVerifier).not.toHaveBeenCalled();
    expect(requireCapturedAuth(authApi).callbackStatus).toMatchObject({
      phase: "completed",
      method: "website",
    });
  });

  it("exchanges Drifty startup Tauri deep-link auth codes", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    exchangeCodeForSession.mockResolvedValueOnce({ data: { session }, error: null });
    tauriMocks.getCurrent.mockResolvedValueOnce([
      "drifty://auth/callback?code=startup-code",
      "drifty://settings?code=ignored",
    ]);

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("startup-code");
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });


  it("exchanges each Tauri onOpenUrl auth code once", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback?code=live-code",
        "drifty://auth/callback?code=live-code",
        "drifty://auth/not-callback?code=ignored",
      ]);
    });

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("live-code");
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it("exchanges direct Google OAuth callbacks through the code-only path", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    exchangeGoogleOAuthCodeForSession.mockResolvedValueOnce({ data: { session }, error: null });

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/google-callback?code=google-code",
      ]);
    });

    await waitFor(() => {
      expect(exchangeGoogleOAuthCodeForSession).toHaveBeenCalledWith(
        "google-code",
        expect.any(AbortSignal),
      );
    });
    expect(setSession).not.toHaveBeenCalledWith({
      access_token: "google-access",
      refresh_token: "google-refresh",
    });
  });

  it("rejects direct Google OAuth callbacks that contain session tokens instead of a code", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/google-callback#access_token=google-access&refresh_token=google-refresh",
      ]);
    });

    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });
    expect(authApi!.callbackStatus?.message).toBe("Session token callbacks are no longer accepted. Sign in with email inside Drifty, or start Google sign-in again.");
    expect(setSession).not.toHaveBeenCalledWith({
      access_token: "google-access",
      refresh_token: "google-refresh",
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalledWith("google-access");
  });

  it("dispatches billing success events for Tauri billing success deep links", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const billingSuccessListener = vi.fn();
    window.addEventListener("drifty:billing-success", billingSuccessListener);

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl(["drifty://billing/success?source=promo"]);
    });

    expect(billingSuccessListener).toHaveBeenCalledTimes(1);
    expect(billingSuccessListener.mock.calls[0]?.[0]).toMatchObject({
      detail: { source: "promo" },
    });
    expect(window.localStorage.getItem("drifty:billing:promo-handoff:v1")).not.toBeNull();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    window.removeEventListener("drifty:billing-success", billingSuccessListener);
  });

  it("dispatches team invite events for Tauri team invite deep links without treating them as auth callbacks", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const teamInviteListener = vi.fn();
    window.addEventListener("drifty:team-invite", teamInviteListener);

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345",
      ]);
    });

    expect(teamInviteListener).toHaveBeenCalledTimes(1);
    expect(teamInviteListener.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        inviteKey: "https://drifty.so/team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345",
        inviteCode: "DRFT-ABCD-2345",
      },
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    window.removeEventListener("drifty:team-invite", teamInviteListener);
  });

  it("applies pending Tauri auth code callback URLs that were cached before the web listener was ready", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    invoke.mockResolvedValueOnce([
      "drifty://auth/callback?code=pending-code",
    ]);

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("pending-code");
    });
  });

  it("keeps empty native callback polls off disk while preserving real callbacks and errors", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    let pendingUrls: string[] = [];
    let pollError: Error | null = null;
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") {
        if (pollError) throw pollError;
        const urls = pendingUrls;
        pendingUrls = [];
        return urls;
      }
      return undefined;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = render(<AuthProvider><CaptureAuth onReady={() => undefined} /></AuthProvider>);
    await waitFor(() => expect(onAuthStateChange).toHaveBeenCalled());
    const storedBeforePolls = window.localStorage.getItem("drifty.auth.diagnostics.v1");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(invoke.mock.calls.filter(([command]) => command === "auth_take_pending_deep_links").length).toBeGreaterThanOrEqual(61);
      expect(window.localStorage.getItem("drifty.auth.diagnostics.v1")).toBe(storedBeforePolls);
      expect(write.mock.calls.filter(([key]) => key === "drifty.auth.diagnostics.v1")).toHaveLength(0);

      pendingUrls = ["drifty://auth/callback?code=later-code"];
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(exchangeCodeForSession).toHaveBeenCalledWith("later-code");
      expect(readAuthDiagnostics()).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: "auth.pending_deep_links.loaded", payload: { pendingUrlCount: 1 } }),
      ]));

      pollError = new Error("native callback queue unavailable");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(readAuthDiagnostics()).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: "auth.pending_deep_links.error" }),
      ]));
    } finally {
      unmount();
      write.mockRestore();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("dispatches pending Tauri team invite URLs cached before the web listener was ready", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const teamInviteListener = vi.fn();
    window.addEventListener("drifty:team-invite", teamInviteListener);
    invoke.mockResolvedValueOnce([
      "drifty://team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345",
    ]);

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(teamInviteListener).toHaveBeenCalledTimes(1);
    });
    expect(teamInviteListener.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        inviteKey: "https://drifty.so/team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345",
        inviteCode: "DRFT-ABCD-2345",
      },
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    window.removeEventListener("drifty:team-invite", teamInviteListener);
  });

  it("restores a desktop session saved outside WebView storage", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session: null } });
    setSession.mockResolvedValue({ data: { session }, error: null });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") {
        return JSON.stringify({ accessToken: "saved-access", refreshToken: "saved-refresh" });
      }
      return undefined;
    });
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => { latestAuth.current = value; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(setSession).toHaveBeenCalledWith({
        access_token: "saved-access",
        refresh_token: "saved-refresh",
      });
    });
    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("authenticated");
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("keeps restoring the native sign-in when the stored WebView session is rejected at launch", async () => {
    // A stale WebView refresh token is rejected while the OS credential store
    // still holds a valid sign-in: Supabase reports SIGNED_OUT during startup,
    // and the native restore then succeeds. The interim event is not a sign-out.
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    // The native restore needs a server round trip; the app renders meanwhile.
    setSession.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ data: { session }, error: null }), 50);
    }));
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") {
        authMocks.authChangeHandler?.("SIGNED_OUT", null);
        authMocks.authChangeHandler?.("SIGNED_OUT", null);
        return JSON.stringify({ accessToken: "saved-access", refreshToken: "saved-refresh" });
      }
      return undefined;
    });
    const statuses: string[] = [];

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => { statuses.push(value.status); }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(statuses[statuses.length - 1]).toBe("authenticated");
    });
    expect(statuses).not.toContain("unauthenticated");
    expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");
    expect(setSession).toHaveBeenCalledWith({
      access_token: "saved-access",
      refresh_token: "saved-refresh",
    });
  });

  it("signs out at launch when neither the stored nor the native sign-in can be restored", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    setSession.mockResolvedValue({ data: { session: null }, error: authServerRejectionError() });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") {
        authMocks.authChangeHandler?.("SIGNED_OUT", null);
        return JSON.stringify({ accessToken: "saved-access", refreshToken: "saved-refresh" });
      }
      return undefined;
    });
    const latestAuth = renderCapturedAuth();

    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("unauthenticated");
    });
    expect(latestAuth.current?.user).toBeNull();
  });

  it("records redacted diagnostics for native session restore", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session: null } });
    setSession.mockResolvedValue({ data: { session }, error: null });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") {
        return JSON.stringify({ accessToken: "saved-access", refreshToken: "saved-refresh" });
      }
      return undefined;
    });

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(setSession).toHaveBeenCalledWith({
        access_token: "saved-access",
        refresh_token: "saved-refresh",
      });
    });

    const entries = readAuthDiagnostics();
    const events = entries.map((entry) => entry.event);
    const serialized = JSON.stringify(entries);

    expect(events).toContain("auth.restore.load.complete");
    expect(events).toContain("auth.restore.set_session.start");
    expect(events).toContain("auth.restore.set_session.success");
    expect(events).toContain("auth.init.complete");
    expect(serialized).not.toContain("saved-access");
    expect(serialized).not.toContain("saved-refresh");
    expect(serialized).not.toContain("access-token");
    expect(serialized).not.toContain("refresh-token");
    expect(serialized).not.toContain("user-id");
  });

  it("rejects Tauri implicit callback sessions from hash tokens", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          latestAuth.current = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback#access_token=access-token&refresh_token=refresh-token",
        "drifty://auth/not-callback#access_token=ignored&refresh_token=ignored",
      ]);
    });

    await waitFor(() => {
      expect(latestAuth.current?.callbackStatus?.phase).toBe("failed");
    });
    expect(latestAuth.current?.callbackStatus?.message).toBe("Session token callbacks are no longer accepted. Sign in with email inside Drifty, or start Google sign-in again.");
    expect(setSession).not.toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(invoke).not.toHaveBeenCalledWith("auth_save_session", {
      value: JSON.stringify({ accessToken: "access-token", refreshToken: "refresh-token" }),
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("exchanges duplicate Tauri auth code callbacks only once", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback?code=auth-code",
        "drifty://auth/callback?code=auth-code",
      ]);
    });

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it("clears the saved desktop session and ends only this computer's session when signing out", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => { latestAuth.current = value; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("authenticated");
    });

    await act(async () => {
      await latestAuth.current?.signOut();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session", { allowInteraction: true });
    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("unauthenticated");
      expect(latestAuth.current?.session).toBeNull();
      expect(latestAuth.current?.cloudConnectionStatus).toBe("online");
    });
  });

  it("does not restore a signed-out session after a stale callback fails", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session: null } });
    setSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Auth session missing"),
    });
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => { latestAuth.current = value; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authMocks.authChangeHandler).not.toBeNull();
    });

    act(() => {
      authMocks.authChangeHandler?.("SIGNED_IN", session);
    });

    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("authenticated");
    });

    await act(async () => {
      await latestAuth.current?.signOut();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback#access_token=stale-access&refresh_token=stale-refresh",
      ]);
    });

    await waitFor(() => {
      expect(latestAuth.current?.callbackStatus?.phase).toBe("failed");
    });

    if (!latestAuth.current) {
      throw new Error("Auth state was not captured.");
    }
    expect(latestAuth.current.session).toBeNull();
    expect(latestAuth.current.user).toBeNull();
    expect(latestAuth.current.status).toBe("unauthenticated");
  });

  it("keeps the local app available when saved auth loading does not resolve", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getSession.mockReturnValue(new Promise(() => undefined));
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          latestAuth.current = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("loading");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("unauthenticated");
      expect(latestAuth.current?.session).toBeNull();
      expect(latestAuth.current?.cloudConnectionStatus).toBe("offline");
    });

    const events = readAuthDiagnostics().map((entry) => entry.event);
    expect(events).toContain("auth.init.timeout");
  });

  it("does not start an anonymous session when auth mode requires sign-in", async () => {
    supabaseConfig.authModePolicy.mode = "required";
    supabaseConfig.authModePolicy.isAuthRequired = true;
    supabaseConfig.authModePolicy.allowsAnonymousAuth = false;
    let latestAuth: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => { latestAuth = value; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(latestAuth).not.toBeNull();
    });

    const result = await latestAuth!.signInAnonymously();

    expect(result.user).toBeNull();
    expect(result.error?.message).toBe("Sign in is required before joining the leaderboard.");
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("shows a retry message for stale Tauri callback tokens without clearing the current session", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    setSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Auth session missing"),
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi?.status).toBe("authenticated");
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback#access_token=stale-access&refresh_token=stale-refresh",
      ]);
    });

    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });

    expect(authApi).not.toBeNull();
    const auth = authApi!;
    expect(auth.callbackStatus?.message).toBe("Session token callbacks are no longer accepted. Sign in with email inside Drifty, or start Google sign-in again.");
    expect(auth.session).toEqual(session);
    expect(auth.status).toBe("authenticated");

    await act(async () => {
      await auth.signInWithWebsite();
    });

    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://drifty.so/auth/login/");
    await waitFor(() => {
      expect(authApi?.callbackStatus?.message).toBe("Browser opened.");
    });

    const entries = readAuthDiagnostics();
    const serialized = JSON.stringify(entries);
    expect(entries.some((entry) => entry.event === "auth.callback.error")).toBe(true);
    expect(serialized).not.toContain("stale-access");
    expect(serialized).not.toContain("stale-refresh");
  });

  it("records auth state change event type and native save ordering", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session: null } });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") return null;
      return undefined;
    });

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authMocks.authChangeHandler).not.toBeNull();
    });

    act(() => {
      authMocks.authChangeHandler?.("TOKEN_REFRESHED", session);
    });

    await waitFor(() => {
      const events = readAuthDiagnostics().map((entry) => entry.event);
      expect(events).toContain("auth.state_change");
      expect(events).toContain("auth.native_save.start");
      expect(events).toContain("auth.native_save.success");
    });

    const entries = readAuthDiagnostics();
    const stateChange = entries.find((entry) => entry.event === "auth.state_change" && entry.payload.eventType === "TOKEN_REFRESHED");
    const saveStartIndex = entries.findIndex((entry) => entry.event === "auth.native_save.start" && entry.payload.operation === "save");
    const saveSuccessIndex = entries.findIndex((entry) => entry.event === "auth.native_save.success" && entry.payload.operation === "save");

    expect(stateChange?.payload.eventType).toBe("TOKEN_REFRESHED");
    expect(saveStartIndex).toBeGreaterThanOrEqual(0);
    expect(saveSuccessIndex).toBeGreaterThan(saveStartIndex);
    expect(JSON.stringify(entries)).not.toContain("access-token");
    expect(JSON.stringify(entries)).not.toContain("refresh-token");
  });

  it("uses drifty.so in stale callback retry messages", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    setSession.mockResolvedValue({
      data: { session: null },
      error: new Error("Auth session missing"),
    });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi?.status).toBe("authenticated");
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback#access_token=stale-access&refresh_token=stale-refresh",
      ]);
    });

    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });

    expect(authApi).not.toBeNull();
    expect(authApi!.callbackStatus?.message).toBe("Session token callbacks are no longer accepted. Sign in with email inside Drifty, or start Google sign-in again.");
  });

  it("clears callback status on request", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback?state=missing-code",
      ]);
    });

    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });

    await act(async () => {
      authApi!.clearCallbackStatus();
    });

    await waitFor(() => {
      expect(authApi?.callbackStatus).toBeNull();
    });
  });

  it("reports Tauri callbacks that contain no sign-in credentials", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(tauriMocks.onOpenUrl).toHaveBeenCalled();
    });

    await act(async () => {
      tauriMocks.emitOpenUrl([
        "drifty://auth/callback?state=missing-code",
      ]);
    });

    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });
    expect(authApi).not.toBeNull();
    expect(authApi!.callbackStatus?.message).toBe("OAuth callback did not include a sign-in code.");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("reports OAuth callback errors from web hash params", async () => {
    window.history.replaceState({}, "", "/auth/callback#error=access_denied&error_description=User denied access");

    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });

    expect(authApi).not.toBeNull();
    expect(authApi!.callbackStatus?.message).toBe("Sign-in was cancelled. Try again when you're ready.");
    expect(authApi!.callbackStatus?.message).not.toContain("User denied access");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("does not reflect hostile provider callback descriptions", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback#error=server_error&error_description=SECRET_TOKEN%3Ddo-not-reflect",
    );
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(authApi?.callbackStatus?.phase).toBe("failed");
    });
    expect(authApi!.callbackStatus?.message).toBe("Sign-in could not be completed. Try again.");
    expect(authApi!.callbackStatus?.message).not.toContain("SECRET_TOKEN");
  });

  it("requests password recovery through the existing code-only desktop bridge", async () => {
    let authApi: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(authApi?.status).toBe("unauthenticated"));

    await act(async () => {
      await authApi!.requestPasswordReset!(" Person@Example.com ");
    });

    expect(resetPasswordForEmail).toHaveBeenCalledWith("person@example.com", {
      redirectTo: "https://drifty.so/auth/callback/",
    });
    expect(authApi!.passwordRecoveryState).toEqual({
      phase: "email-sent",
      email: "person@example.com",
    });
  });

  it("holds a verified recovery callback behind required auth until the password is updated", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const recoverySession = createSession({ email: "person@example.com" });
    exchangeCodeForSession.mockResolvedValueOnce({ data: { session: recoverySession }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(tauriMocks.onOpenUrl).toHaveBeenCalled());

    await act(async () => {
      await authApi!.requestPasswordReset!("person@example.com");
      tauriMocks.emitOpenUrl(["drifty://auth/callback?code=recovery-code"]);
    });
    await waitFor(() => expect(authApi?.passwordRecoveryState?.phase).toBe("awaiting-new-password"));

    expect(authApi!.user).toBeNull();
    expect(authApi!.status).toBe("unauthenticated");
    expect(authApi!.hasRequiredAccountAuth).toBe(false);

    getSession.mockResolvedValueOnce({ data: { session: recoverySession }, error: null });
    await act(async () => {
      await authApi!.updatePassword!("new-password-123");
    });

    expect(updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
    expect(authApi!.user?.email).toBe("person@example.com");
    expect(authApi!.status).toBe("authenticated");
    expect(authApi!.hasRequiredAccountAuth).toBe(true);
  });

  it("rejects a recovery callback whose account does not match the requested email", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const wrongSession = createSession({ email: "different@example.com" });
    exchangeCodeForSession.mockResolvedValueOnce({ data: { session: wrongSession }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(tauriMocks.onOpenUrl).toHaveBeenCalled());

    await act(async () => {
      await authApi!.requestPasswordReset!("person@example.com");
      tauriMocks.emitOpenUrl(["drifty://auth/callback?code=wrong-account-code"]);
    });
    await waitFor(() => expect(authApi?.passwordRecoveryState?.phase).toBe("failed"));

    expect(authApi!.passwordRecoveryState?.errorKind).toBe("identity-mismatch");
    expect(authApi!.user).toBeNull();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("keeps a staged recovery session gated when cancellation cannot clear the stored session", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const recoverySession = createSession({ email: "person@example.com" });
    exchangeCodeForSession.mockResolvedValueOnce({ data: { session: recoverySession }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(tauriMocks.onOpenUrl).toHaveBeenCalled());

    await act(async () => {
      await authApi!.requestPasswordReset!("person@example.com");
      tauriMocks.emitOpenUrl(["drifty://auth/callback?code=recovery-cancel-code"]);
    });
    await waitFor(() => expect(authApi?.passwordRecoveryState?.phase).toBe("awaiting-new-password"));

    signOut.mockResolvedValueOnce({ error: new Error("local sign-out failed") });
    await act(async () => {
      await authApi!.cancelPasswordRecovery!();
    });

    expect(authApi!.user).toBeNull();
    expect(authApi!.status).toBe("unauthenticated");
    expect(authApi!.passwordRecoveryState?.phase).toBe("awaiting-new-password");
    expect(authApi!.callbackStatus).toMatchObject({
      phase: "failed",
      message: expect.stringMatching(/could not be cancelled securely/i),
    });

    act(() => {
      authMocks.authChangeHandler?.("TOKEN_REFRESHED", recoverySession);
    });
    await waitFor(() => expect(authApi?.passwordRecoveryState?.phase).toBe("awaiting-new-password"));
    expect(authApi!.user).toBeNull();
    expect(authApi!.status).toBe("unauthenticated");

    await act(async () => {
      await authApi!.cancelPasswordRecovery!();
    });
    expect(authApi!.passwordRecoveryState?.phase).toBe("idle");
    expect(authApi!.callbackStatus).toBeNull();
    expect(authApi!.user).toBeNull();
  });

  it("keeps an identity-mismatched recovery session gated across a cold restore when local sign-out fails", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const wrongSession = createSession({ email: "different@example.com" });
    exchangeCodeForSession.mockResolvedValueOnce({ data: { session: wrongSession }, error: null });
    signOut.mockResolvedValue({ error: new Error("local sign-out failed") });
    let authApi: ReturnType<typeof useAuth> | null = null;
    const firstRender = render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(tauriMocks.onOpenUrl).toHaveBeenCalled());

    await act(async () => {
      await authApi!.requestPasswordReset!("person@example.com");
      tauriMocks.emitOpenUrl(["drifty://auth/callback?code=recovery-wrong-account-code"]);
    });
    await waitFor(() => expect(authApi?.passwordRecoveryState?.phase).toBe("failed"));
    expect(authApi!.user).toBeNull();

    let blockedSignInResult!: { error: Error | null };
    await act(async () => {
      blockedSignInResult = await authApi!.signInWithEmail("person@example.com", "password-123");
    });
    expect(blockedSignInResult.error?.message).toMatch(/could not be cancelled securely/i);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(authApi!.user).toBeNull();
    firstRender.unmount();

    getSession.mockResolvedValue({ data: { session: wrongSession }, error: null });
    authApi = null;
    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => expect(authApi?.status).toBe("unauthenticated"));
    expect(authApi!.user).toBeNull();
    expect(authApi!.hasRequiredAccountAuth).toBe(false);
    expect(authApi!.passwordRecoveryState?.errorKind).toBe("identity-mismatch");
  });

  it("does not classify a fresh in-app Google sign-in as password recovery", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const googleSession = createSession({ email: "google-user@example.com" });
    exchangeGoogleOAuthCodeForSession.mockResolvedValueOnce({ data: { session: googleSession }, error: null });
    let authApi: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(tauriMocks.onOpenUrl).toHaveBeenCalled());

    await act(async () => {
      await authApi!.requestPasswordReset!("person@example.com");
      await authApi!.signInWithGoogle();
      tauriMocks.emitOpenUrl(["drifty://auth/google-callback?code=google-after-recovery-request"]);
    });
    await waitFor(() => expect(authApi?.status).toBe("authenticated"));

    expect(authApi!.user?.email).toBe("google-user@example.com");
    expect(authApi!.passwordRecoveryState?.phase).toBe("idle");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("blocks browser auth while offline and lets a live retry override a stale offline OS flag", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "GoTrue" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    let authApi: ReturnType<typeof useAuth> | null = null;
    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(authApi?.cloudConnectionStatus).toBe("offline"));

    await act(async () => {
      expect((await authApi!.signInWithGoogle()).error?.message).toMatch(/offline/i);
      expect((await authApi!.signInWithWebsite()).error?.message).toMatch(/offline/i);
    });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();

    getSession.mockClear();
    await act(async () => {
      expect((await authApi!.retryCloudConnection!()).error).toBeNull();
    });
    await waitFor(() => expect(authApi?.cloudConnectionStatus).toBe("online"));
    expect(window.navigator.onLine).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://project.supabase.co/auth/v1/health");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });

    const session = createSession({ email: "person@example.com" });
    act(() => {
      authMocks.authChangeHandler?.("SIGNED_IN", session);
    });
    await waitFor(() => expect(authApi?.status).toBe("authenticated"));
    expect(authApi!.cloudConnectionStatus).toBe("online");
  });

  it("keeps retry offline when a cached session exists but the live auth probe fails", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    const cachedSession = createSession({ email: "person@example.com" });
    getSession.mockResolvedValue({ data: { session: cachedSession }, error: null });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Network request failed"));
    vi.stubGlobal("fetch", fetchMock);
    let authApi: ReturnType<typeof useAuth> | null = null;

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          authApi = value;
        }} />
      </AuthProvider>
    );
    await waitFor(() => expect(authApi?.status).toBe("authenticated"));
    await waitFor(() => expect(authApi?.cloudConnectionStatus).toBe("offline"));

    getSession.mockClear();
    let retryResult!: { error: Error | null };
    await act(async () => {
      retryResult = await authApi!.retryCloudConnection!();
    });

    expect(retryResult.error?.message).toMatch(/network request failed/i);
    expect(authApi!.cloudConnectionStatus).toBe("offline");
    expect(authApi!.user?.email).toBe("person@example.com");
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("saved sign-in while the auth server is unreachable", () => {
    beforeEach(() => {
      supabaseConfig.authModePolicy.mode = "required";
      supabaseConfig.authModePolicy.isAuthRequired = true;
      supabaseConfig.authModePolicy.allowsAnonymousAuth = false;
    });

    it("opens on the saved account when the server cannot confirm a native saved sign-in", async () => {
      mockNativeSavedSession();
      setSession.mockResolvedValue({ data: { session: null, user: null }, error: authServerUnreachableError() });
      getSession.mockResolvedValue({ data: { session: null }, error: authServerUnreachableError() });

      const latestAuth = renderCapturedAuth();

      await expectSavedSignInPending(latestAuth);
      expect(setSession).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");
      const entries = readAuthDiagnostics();
      expect(entries.map((entry) => entry.event)).toContain("auth.saved_sign_in.pending");
      const serialized = JSON.stringify(entries);
      expect(serialized).not.toContain("saved-refresh");
      expect(serialized).not.toContain(SAVED_ACCOUNT_EMAIL);
    });

    it("opens on the saved account at once when launched offline with an expired stored session", async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      storeSavedWebViewSession();

      const latestAuth = renderCapturedAuth();

      await expectSavedSignInPending(latestAuth);
      // Refreshing an expired session needs the server, so the launch does not wait on it.
      expect(getSession).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("drifty.desktop.auth")).not.toBeNull();
    });

    it("keeps the saved account when restoring does not finish before the launch timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      storeSavedWebViewSession();
      getSession.mockReturnValue(new Promise(() => undefined));

      const latestAuth = renderCapturedAuth();
      await waitFor(() => expect(latestAuth.current?.status).toBe("loading"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });

      await expectSavedSignInPending(latestAuth);
      const events = readAuthDiagnostics().map((entry) => entry.event);
      expect(events).toContain("auth.init.timeout");
      expect(events).toContain("auth.saved_sign_in.pending");
    });

    it("signs out at launch when the server rejects the saved sign-in", async () => {
      storeSavedWebViewSession();
      getSession.mockResolvedValue({ data: { session: null }, error: authServerRejectionError() });

      const latestAuth = renderCapturedAuth();

      await waitFor(() => expect(latestAuth.current?.status).toBe("unauthenticated"));
      expect(latestAuth.current?.user).toBeNull();
      expect(latestAuth.current?.isSavedSignInPending).toBe(false);
    });

    it("does not open on a saved account while a password recovery is pending", async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      storeSavedWebViewSession();
      window.localStorage.setItem("drifty.desktop.password-recovery", "{}");

      const latestAuth = renderCapturedAuth();

      await waitFor(() => expect(latestAuth.current?.status).toBe("unauthenticated"));
      expect(latestAuth.current?.user).toBeNull();
      expect(latestAuth.current?.isSavedSignInPending).toBe(false);
    });

    it("confirms the saved sign-in once the server is reachable again", async () => {
      mockNativeSavedSession();
      setSession.mockResolvedValue({ data: { session: null, user: null }, error: authServerUnreachableError() });
      getSession.mockResolvedValue({ data: { session: null }, error: authServerUnreachableError() });
      const latestAuth = renderCapturedAuth();
      await expectSavedSignInPending(latestAuth);

      const confirmedSession = createSession({ email: SAVED_ACCOUNT_EMAIL });
      setSession.mockResolvedValue({ data: { session: confirmedSession, user: confirmedSession.user }, error: null });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "GoTrue" }), { status: 200 })));
      let retryResult!: { error: Error | null };
      await act(async () => {
        retryResult = await latestAuth.current!.retryCloudConnection!();
      });

      expect(retryResult.error).toBeNull();
      await waitFor(() => expect(latestAuth.current?.isSavedSignInPending).toBe(false));
      const auth = requireCapturedAuth(latestAuth.current);
      expect(auth.status).toBe("authenticated");
      expect(auth.session).toBe(confirmedSession);
      expect(auth.cloudConnectionStatus).toBe("online");
    });

    it("keeps cloud work offline when the server answers but the sign-in still cannot be confirmed", async () => {
      mockNativeSavedSession();
      setSession.mockResolvedValue({ data: { session: null, user: null }, error: authServerUnreachableError() });
      getSession.mockResolvedValue({ data: { session: null }, error: authServerUnreachableError() });
      const latestAuth = renderCapturedAuth();
      await expectSavedSignInPending(latestAuth);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "GoTrue" }), { status: 200 })));
      let retryResult!: { error: Error | null };
      await act(async () => {
        retryResult = await latestAuth.current!.retryCloudConnection!();
      });

      expect(retryResult.error?.message).toMatch(/offline/i);
      await expectSavedSignInPending(latestAuth);
    });

    it("signs out when the server rejects the saved sign-in after reconnecting", async () => {
      mockNativeSavedSession();
      setSession.mockResolvedValue({ data: { session: null, user: null }, error: authServerUnreachableError() });
      getSession.mockResolvedValue({ data: { session: null }, error: authServerUnreachableError() });
      const latestAuth = renderCapturedAuth();
      await expectSavedSignInPending(latestAuth);

      setSession.mockResolvedValue({ data: { session: null, user: null }, error: authServerRejectionError() });
      getSession.mockResolvedValue({ data: { session: null }, error: authServerRejectionError() });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "GoTrue" }), { status: 200 })));
      await act(async () => {
        await latestAuth.current!.retryCloudConnection!();
      });

      await waitFor(() => expect(latestAuth.current?.status).toBe("unauthenticated"));
      expect(latestAuth.current?.user).toBeNull();
      expect(latestAuth.current?.isSavedSignInPending).toBe(false);
      expect(readAuthDiagnostics().map((entry) => entry.event)).toContain("auth.saved_sign_in.rejected");
    });

    it("confirms the saved sign-in when the client refreshes it in the background", async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      storeSavedWebViewSession();
      const latestAuth = renderCapturedAuth();
      await expectSavedSignInPending(latestAuth);

      const refreshedSession = createSession({ email: SAVED_ACCOUNT_EMAIL });
      act(() => {
        authMocks.authChangeHandler?.("TOKEN_REFRESHED", refreshedSession);
      });

      await waitFor(() => expect(latestAuth.current?.isSavedSignInPending).toBe(false));
      expect(latestAuth.current?.session).toBe(refreshedSession);
    });

    it("ignores a null session report while unreachable and ends the saved sign-in on sign-out", async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      storeSavedWebViewSession();
      const latestAuth = renderCapturedAuth();
      await expectSavedSignInPending(latestAuth);

      act(() => {
        authMocks.authChangeHandler?.("INITIAL_SESSION", null);
      });
      await expectSavedSignInPending(latestAuth);

      act(() => {
        authMocks.authChangeHandler?.("SIGNED_OUT", null);
      });
      await waitFor(() => expect(latestAuth.current?.status).toBe("unauthenticated"));
      expect(latestAuth.current?.isSavedSignInPending).toBe(false);
    });

    it("signs out on this device without contacting the unreachable server", async () => {
      Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
      storeSavedWebViewSession();
      const latestAuth = renderCapturedAuth();
      await expectSavedSignInPending(latestAuth);

      await act(async () => {
        await latestAuth.current!.signOut();
      });

      expect(signOut).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("drifty.desktop.auth")).toBeNull();
      const auth = requireCapturedAuth(latestAuth.current);
      expect(auth.status).toBe("unauthenticated");
      expect(auth.user).toBeNull();
      expect(auth.isSavedSignInPending).toBe(false);
      expect(auth.cloudConnectionStatus).toBe("offline");
    });
  });
});
