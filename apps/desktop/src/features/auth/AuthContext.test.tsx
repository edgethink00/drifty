// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const { authMocks, getSession, onAuthStateChange, exchangeCodeForSession, setSession, signInAnonymously, signOut, invoke } = vi.hoisted(() => {
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
    setSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInAnonymously: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
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
  hasBlockingAuthConfigurationError: () => supabaseConfig.hasBlockingAuthConfigurationError,
  supabase: {
    auth: {
      getSession,
      onAuthStateChange,
      exchangeCodeForSession,
      setSession,
      signInAnonymously,
      signOut,
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
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

import { AuthProvider, hasRequiredAccountAuth, isAnonymousSupabaseUser, useAuth } from "./AuthContext";
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

describe("AuthContext", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
    exchangeCodeForSession.mockResolvedValue({ error: null });
    setSession.mockResolvedValue({ data: { session: null }, error: null });
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
      expect(authApi?.callbackStatus?.message).toBe("Browser opened. Complete sign-in on drifty.so, then choose Open Drifty.");
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
      expect(authApi?.callbackStatus?.message).toBe("Browser opened. Complete sign-in on drifty.so, then choose Open Drifty.");
    });
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
      tauriMocks.emitOpenUrl(["drifty://billing/success"]);
    });

    expect(billingSuccessListener).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    window.removeEventListener("drifty:billing-success", billingSuccessListener);
  });

  it("applies pending Tauri auth callback URLs that were cached before the web listener was ready", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    setSession.mockResolvedValue({ data: { session }, error: null });
    invoke.mockResolvedValueOnce([
      "drifty://auth/callback?access_token=pending-access&refresh_token=pending-refresh",
    ]);

    render(
      <AuthProvider>
        <CaptureAuth onReady={() => undefined} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(setSession).toHaveBeenCalledWith({
        access_token: "pending-access",
        refresh_token: "pending-refresh",
      });
    });
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

  it("applies Tauri implicit callback sessions from hash tokens", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    setSession.mockResolvedValue({ data: { session }, error: null });

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
        "drifty://auth/callback#access_token=access-token&refresh_token=refresh-token",
        "drifty://auth/not-callback#access_token=ignored&refresh_token=ignored",
      ]);
    });

    await waitFor(() => {
      expect(setSession).toHaveBeenCalledWith({
        access_token: "access-token",
        refresh_token: "refresh-token",
      });
    });
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("auth_save_session", {
      value: JSON.stringify({ accessToken: "access-token", refreshToken: "refresh-token" }),
    });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("applies duplicate Tauri implicit callback sessions only once", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    setSession.mockResolvedValue({ data: { session }, error: null });

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
        "drifty://auth/callback?access_token=access-token&refresh_token=refresh-token",
        "drifty://auth/callback?access_token=access-token&refresh_token=refresh-token",
      ]);
    });

    await waitFor(() => {
      expect(setSession).toHaveBeenCalledWith({
        access_token: "access-token",
        refresh_token: "refresh-token",
      });
    });
    expect(setSession).toHaveBeenCalledTimes(1);
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
    expect(auth.callbackStatus?.message).toBe("That sign-in link was incomplete or expired. Please sign in again on drifty.so.");
    expect(auth.session).toEqual(session);
    expect(auth.status).toBe("authenticated");

    await act(async () => {
      await auth.signInWithWebsite();
    });

    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://drifty.so/auth/login/");
    await waitFor(() => {
      expect(authApi?.callbackStatus?.message).toBe("Browser opened. Complete sign-in on drifty.so, then choose Open Drifty.");
    });

    const entries = readAuthDiagnostics();
    const serialized = JSON.stringify(entries);
    expect(entries.some((entry) => entry.event === "auth.callback.session.error")).toBe(true);
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
    expect(authApi!.callbackStatus?.message).toBe("That sign-in link was incomplete or expired. Please sign in again on drifty.so.");
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
    expect(authApi!.callbackStatus?.message).toBe("OAuth callback did not include a sign-in code or session tokens.");
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
    expect(authApi!.callbackStatus?.message).toBe("OAuth callback failed: User denied access");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });
});
