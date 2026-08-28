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
  signInWithOAuth,
  activateGoogleOAuthVerifier,
  clearGoogleOAuthVerifier,
  hasUsableGoogleOAuthVerifier,
  signInWithPassword,
  signUp,
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
    signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: "https://project.supabase.co/auth/v1/authorize?provider=google" }, error: null }),
    activateGoogleOAuthVerifier: vi.fn(),
    clearGoogleOAuthVerifier: vi.fn(() => true),
    hasUsableGoogleOAuthVerifier: vi.fn(() => true),
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
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
      signInWithOAuth,
      signOut,
      signInWithPassword,
      signUp,
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

function createSession({ isAnonymous = false }: { isAnonymous?: boolean } = {}): Session {
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
    },
  } as Session;
}

function requireCapturedAuth(auth: ReturnType<typeof useAuth> | null): ReturnType<typeof useAuth> {
  if (!auth) {
    throw new Error("Auth state was not captured.");
  }
  return auth;
}

describe("AuthContext", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
    exchangeCodeForSession.mockResolvedValue({ error: null });
    exchangeGoogleOAuthCodeForSession.mockResolvedValue({ data: { session: null }, error: null });
    setSession.mockResolvedValue({ data: { session: null }, error: null });
    signInWithOAuth.mockResolvedValue({ data: { url: googleOAuthUrl() }, error: null });
    clearGoogleOAuthVerifier.mockReturnValue(true);
    hasUsableGoogleOAuthVerifier.mockReturnValue(true);
    signInWithPassword.mockResolvedValue({ data: {}, error: null });
    signUp.mockResolvedValue({ data: { session: null }, error: null });
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    clearAuthDiagnostics({ mirrorToConsole: false });
    window.history.replaceState({}, "", "/");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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

  it("clears the saved desktop session when signing out", async () => {
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
    expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session");
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
});
