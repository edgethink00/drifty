// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthChangeHandler = (event: string, session: Session | null) => void;

const { authMocks, getSession, onAuthStateChange, setSession, signInWithPassword, signOut, invoke } = vi.hoisted(() => {
  const mocks: { authChangeHandler: AuthChangeHandler | null } = {
    authChangeHandler: null,
  };

  return {
    authMocks: mocks,
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn((handler: AuthChangeHandler) => {
      mocks.authChangeHandler = handler;
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      };
    }),
    setSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    invoke: vi.fn().mockResolvedValue([]),
  };
});

const tauriMocks = vi.hoisted(() => ({
  getCurrent: vi.fn().mockResolvedValue(null),
  onOpenUrl: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("../../lib/supabase/client", () => ({
  authModePolicy: {
    mode: "optional",
    isAuthRequired: false,
    allowsAnonymousAuth: true,
  },
  clearGoogleOAuthVerifier: vi.fn(() => true),
  getGoogleOAuthAuthorizeUrl: () => "https://project.supabase.co/auth/v1/authorize",
  hasBlockingAuthConfigurationError: () => false,
  hasUsableGoogleOAuthVerifier: () => true,
  isSupabaseEnabled: () => true,
  prepareGoogleOAuthAuthorization: vi.fn(),
  supabase: {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getSession,
      onAuthStateChange,
      setSession,
      signInAnonymously: vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: null }, error: null }),
      signInWithPassword,
      signOut,
      signUp: vi.fn(),
    },
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: tauriMocks.getCurrent,
  onOpenUrl: tauriMocks.onOpenUrl,
}));

import { AuthProvider, useAuth } from "./AuthContext";
import { clearAuthDiagnostics } from "./authDiagnostics";
import { DESKTOP_AUTH_SESSION_CHANGING, DESKTOP_AUTH_SESSION_FAILED } from "./desktopAuthSessionEvents";

type SupabaseSessionResult = {
  readonly data: {
    readonly session: Session | null;
  };
  readonly error: Error | null;
};

function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  if (!resolve) {
    throw new Error("Deferred promise resolver was not initialized.");
  }

  return { promise, resolve };
}

function createSession(): Session {
  const user: Session["user"] = {
    id: "user-id",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
    is_anonymous: false,
  };

  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}

function CaptureAuth({ onReady }: { readonly onReady: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();

  useEffect(() => {
    onReady(auth);
  }, [auth, onReady]);

  return null;
}

describe("AuthContext desktop session persistence", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
    setSession.mockResolvedValue({ data: { session: null }, error: null });
    signInWithPassword.mockReset();
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
    invoke.mockResolvedValue([]);
    authMocks.authChangeHandler = null;
    tauriMocks.getCurrent.mockResolvedValue(null);
    tauriMocks.onOpenUrl.mockResolvedValue(vi.fn());
    clearAuthDiagnostics({ mirrorToConsole: false });
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearAuthDiagnostics({ mirrorToConsole: false });
    window.history.replaceState({}, "", "/");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("keeps native session while restore is in flight when Supabase emits an initial null session", async () => {
    const restoredSession = createSession();
    const restoreSession = createDeferred<SupabaseSessionResult>();
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };

    setSession.mockImplementation(() => restoreSession.promise);
    invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "auth_take_pending_deep_links":
          return [];
        case "auth_load_saved_session":
          return JSON.stringify({ accessToken: "saved-access", refreshToken: "saved-refresh" });
        case "auth_clear_saved_session":
        case "auth_save_session":
          return undefined;
        default:
          return undefined;
      }
    });

    render(
      <AuthProvider>
        <CaptureAuth onReady={(value) => {
          latestAuth.current = value;
        }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(setSession).toHaveBeenCalledWith({
        access_token: "saved-access",
        refresh_token: "saved-refresh",
      });
      expect(authMocks.authChangeHandler).not.toBeNull();
    });

    act(() => {
      authMocks.authChangeHandler?.("INITIAL_SESSION", null);
    });

    expect(latestAuth.current?.status).toBe("loading");
    expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");

    await act(async () => {
      restoreSession.resolve({ data: { session: restoredSession }, error: null });
      await restoreSession.promise;
    });

    await waitFor(() => {
      expect(latestAuth.current?.status).toBe("authenticated");
      expect(latestAuth.current?.session).toEqual(restoredSession);
    });
    expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");
  });

  it("preserves the native session when a failed restore emits SIGNED_OUT first", async () => {
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") {
        return JSON.stringify({ accessToken: "saved-access", refreshToken: "saved-refresh" });
      }
      return undefined;
    });
    setSession.mockImplementation(async () => {
      authMocks.authChangeHandler?.("SIGNED_OUT", null);
      return { data: { session: null }, error: new Error("Session restore unavailable") };
    });

    render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);

    await waitFor(() => expect(latestAuth.current?.status).toBe("unauthenticated"));
    expect(setSession).toHaveBeenCalledWith({ access_token: "saved-access", refresh_token: "saved-refresh" });
    expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");

    act(() => authMocks.authChangeHandler?.("SIGNED_OUT", null));
    expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");

    await act(async () => { await latestAuth.current?.signOut(); });
    expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session", { allowInteraction: true });
  });


  it("does not complete sign-out when the saved desktop credential cannot be cleared", async () => {
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    const session = createSession();
    const clearError = new Error("Synthetic native credential deletion denied");
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") return null;
      if (command === "auth_clear_saved_session") throw clearError;
      return undefined;
    });
    render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    await waitFor(() => expect(latestAuth.current?.status).toBe("authenticated"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));

    let received: unknown;
    await act(async () => {
      try { await latestAuth.current?.signOut(); }
      catch (error) { received = error; }
    });
    expect(received).toBe(clearError);
    expect(signOut).not.toHaveBeenCalled();
    expect(latestAuth.current?.status).toBe("authenticated");
    expect(latestAuth.current?.session).toEqual(session);
  });


  it("serializes old saves, coalesces sign-out, and prevents token events from repopulating the credential", async () => {
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    const session = createSession();
    const pendingSave = createDeferred<void>();
    const pendingClear = createDeferred<void>();
    const cloudLogout = createDeferred<{ error: null }>();
    let storedCredential: string | null = null;
    getSession.mockResolvedValue({ data: { session } });
    signOut.mockReturnValue(cloudLogout.promise);
    invoke.mockImplementation(async (command: string, args?: { value: string }) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") return null;
      if (command === "auth_save_session") {
        if (JSON.parse(args!.value).accessToken === "pending-refresh") await pendingSave.promise;
        storedCredential = args!.value;
      }
      if (command === "auth_clear_saved_session") {
        await pendingClear.promise;
        storedCredential = null;
      }
      return undefined;
    });
    render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    await waitFor(() => expect(latestAuth.current?.status).toBe("authenticated"));
    await waitFor(() => expect(storedCredential).not.toBeNull());
    invoke.mockClear();
    act(() => authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "pending-refresh" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = latestAuth.current!.signOut(); second = latestAuth.current!.signOut(); });
    expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");
    expect(signOut).not.toHaveBeenCalled();
    await act(async () => { pendingSave.resolve(undefined); });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session", { allowInteraction: true }));
    expect(signOut).not.toHaveBeenCalled();

    await act(async () => { pendingClear.resolve(undefined); });
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(storedCredential).toBeNull();
    await act(async () => {
      authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "post-clear-refresh" });
      await Promise.resolve();
    });
    expect(storedCredential).toBeNull();
    expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(1);
    await act(async () => { cloudLogout.resolve({ error: null }); await Promise.all([first, second]); });
    expect(invoke.mock.calls.filter(([command]) => command === "auth_clear_saved_session")).toHaveLength(1);
    expect(latestAuth.current?.status).toBe("unauthenticated");
    expect(storedCredential).toBeNull();
  });

  it("propagates a returned cloud sign-out error while keeping the native credential cleared", async () => {
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    const session = createSession();
    const cloudError = new Error("Synthetic cloud sign-out failure");
    let cleared = false;
    getSession.mockResolvedValue({ data: { session } });
    signOut.mockResolvedValue({ error: cloudError });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") return null;
      if (command === "auth_clear_saved_session") cleared = true;
      return undefined;
    });
    render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    await waitFor(() => expect(latestAuth.current?.status).toBe("authenticated"));
    let received: unknown;
    await act(async () => { try { await latestAuth.current!.signOut(); } catch (error) { received = error; } });
    expect(received).toBe(cloudError);
    expect(cleared).toBe(true);
    expect(latestAuth.current?.session).toEqual(session);
    expect(latestAuth.current?.status).toBe("authenticated");
  });

  it("recovers the native write queue and supports retry after a clear error", async () => {
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    const session = createSession();
    let denyClear = true;
    let storedCredential: string | null = null;
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation(async (command: string, args?: { value: string }) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_load_saved_session") return null;
      if (command === "auth_save_session") storedCredential = args!.value;
      if (command === "auth_clear_saved_session") {
        if (denyClear) throw "Synthetic credential-store clear error";
        storedCredential = null;
      }
      return undefined;
    });
    render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    await waitFor(() => expect(latestAuth.current?.status).toBe("authenticated"));
    let received: unknown;
    await act(async () => { try { await latestAuth.current!.signOut(); } catch (error) { received = error; } });
    expect(received).toBe("Synthetic credential-store clear error");
    expect(signOut).not.toHaveBeenCalled();
    denyClear = false;
    act(() => authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "retry-refresh" }));
    await waitFor(() => expect(storedCredential && JSON.parse(storedCredential).accessToken).toBe("retry-refresh"));
    await act(async () => { await latestAuth.current!.signOut(); });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(storedCredential).toBeNull();
    expect(latestAuth.current?.status).toBe("unauthenticated");
  });

  it("finishes a pending native save before a later sign-out clear", async () => {
    const pendingSave = createDeferred<void>();
    invoke.mockImplementation((command: string) => {
      if (command === "auth_take_pending_deep_links") return Promise.resolve([]);
      if (command === "auth_load_saved_session") return Promise.resolve(null);
      if (command === "auth_save_session") return pendingSave.promise;
      return Promise.resolve(undefined);
    });

    render(<AuthProvider><CaptureAuth onReady={() => {}} /></AuthProvider>);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session"));
    invoke.mockClear();

    act(() => authMocks.authChangeHandler?.("SIGNED_IN", createSession()));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));
    act(() => authMocks.authChangeHandler?.("SIGNED_OUT", null));
    expect(invoke).not.toHaveBeenCalledWith("auth_clear_saved_session");

    await act(async () => {
      pendingSave.resolve();
      await pendingSave.promise;
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session"));
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "auth_save_session",
      "auth_clear_saved_session",
    ]);
  });

  it("keeps the live capability when focus repeats a successfully saved sign-in", async () => {
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation(async (command: string) => command === "auth_take_pending_deep_links" ? [] : null);
    render(<AuthProvider><CaptureAuth onReady={() => {}} /></AuthProvider>);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));
    const changing = vi.fn();
    window.addEventListener(DESKTOP_AUTH_SESSION_CHANGING, changing);
    try {
      invoke.mockClear();
      await act(async () => {
        authMocks.authChangeHandler?.("SIGNED_IN", { ...session, user: { ...session.user } });
        authMocks.authChangeHandler?.("SIGNED_IN", { ...session, expires_in: 3500 });
      });
      expect(invoke).not.toHaveBeenCalledWith("auth_save_session", expect.anything());
      expect(changing).not.toHaveBeenCalled();
      // A changed access token, refresh token or account still revokes before saving.
      for (const next of [
        { ...session, access_token: "changed-access" },
        { ...session, access_token: "changed-access", refresh_token: "changed-refresh" },
        { ...session, access_token: "changed-access", refresh_token: "changed-refresh", user: { ...session.user, id: "other-user" } },
      ]) {
        await act(async () => authMocks.authChangeHandler?.("SIGNED_IN", next));
      }
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(3);
      expect(changing).toHaveBeenCalledTimes(3);
    } finally { window.removeEventListener(DESKTOP_AUTH_SESSION_CHANGING, changing); }
  });

  it("coalesces duplicate saves only after the queued native write succeeds", async () => {
    const session = createSession();
    const pending = createDeferred<void>();
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation((command: string) => command === "auth_save_session"
      ? pending.promise : Promise.resolve(command === "auth_take_pending_deep_links" ? [] : null));
    render(<AuthProvider><CaptureAuth onReady={() => {}} /></AuthProvider>);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));
    act(() => authMocks.authChangeHandler?.("SIGNED_IN", session));
    expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(1);
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(1);
  });

  it.each(["previous", "failed"] as const)("persists the %s credential again after a failed write", async (retry) => {
    const session = createSession();
    let fail = false;
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_save_session" && fail) throw new Error("Synthetic credential write failed");
      return null;
    });
    render(<AuthProvider><CaptureAuth onReady={() => {}} /></AuthProvider>);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));
    const failed = vi.fn();
    window.addEventListener(DESKTOP_AUTH_SESSION_FAILED, failed);
    try {
      invoke.mockClear(); fail = true;
      await act(async () => authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "failed-refresh" }));
      expect(failed).toHaveBeenCalledTimes(1);
      fail = false;
      await act(async () => authMocks.authChangeHandler?.("SIGNED_IN", retry === "failed" ? { ...session, access_token: "failed-refresh" } : session));
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(2);
      // Clearing is always a real credential operation, and a later sign-in must save again.
      await act(async () => authMocks.authChangeHandler?.("SIGNED_OUT", null));
      await act(async () => authMocks.authChangeHandler?.("SIGNED_IN", session));
      expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session");
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(3);
    } finally { window.removeEventListener(DESKTOP_AUTH_SESSION_FAILED, failed); }
  });


  it.each(["AUTH_SESSION_ACCESS_DENIED", new Error("AUTH_SESSION_ACCESS_DENIED")])("coalesces denied focus/token events while waiting for recovery and permits explicit login (%s)", async (denied) => {
    const session = createSession();
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    let rejectSave = true;
    getSession.mockResolvedValue({ data: { session } });
    signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_save_session" && rejectSave) throw denied;
      return null;
    });
    render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));
    invoke.mockClear();
    const changing = vi.fn();
    window.addEventListener(DESKTOP_AUTH_SESSION_CHANGING, changing);
    try {
      await act(async () => {
        for (let i = 0; i < 60; i++) {
          authMocks.authChangeHandler?.("SIGNED_IN", { ...session, expires_in: 3000 - i });
          authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: `rotated-${i}` });
        }
      });
      expect(invoke).not.toHaveBeenCalledWith("auth_save_session", expect.anything());
      expect(changing).not.toHaveBeenCalled();
      rejectSave = false;
      await act(async () => { await latestAuth.current!.signInWithEmail("person@example.com", "password"); });
      expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.objectContaining({ allowInteraction: true }));
      invoke.mockClear();
      await act(async () => authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "recovered-refresh" }));
      expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.not.objectContaining({ allowInteraction: true }));
    } finally { window.removeEventListener(DESKTOP_AUTH_SESSION_CHANGING, changing); }
  });


  it("silently saves the latest token pair after inaccessible storage recovers", async () => {
    vi.useFakeTimers();
    let locked = true;
    let stored: string | null = null;
    const session = createSession();
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation(async (command: string, args?: { value: string }) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_save_session") {
        if (locked) throw "AUTH_SESSION_ACCESS_DENIED";
        stored = args!.value;
      }
      return null;
    });
    const failed = vi.fn();
    window.addEventListener(DESKTOP_AUTH_SESSION_FAILED, failed);
    const view = render(<AuthProvider><CaptureAuth onReady={() => {}} /></AuthProvider>);
    try {
      await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
      await act(async () => {
        authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "older-pending", refresh_token: "older-refresh" });
        authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "latest-pending", refresh_token: "latest-refresh" });
      });
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(1);
      locked = false;
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(JSON.parse(stored!)).toEqual({ accessToken: "latest-pending", refreshToken: "latest-refresh" });
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(2);
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session").some(([, args]) => args?.allowInteraction)).toBe(false);
      expect(signInWithPassword).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(2);
    } finally {
      view.unmount();
      window.removeEventListener(DESKTOP_AUTH_SESSION_FAILED, failed);
      vi.useRealTimers();
    }
  });

  it("backs off silent retries and cancels them after successful logout", async () => {
    vi.useFakeTimers();
    const session = createSession();
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_save_session") throw "AUTH_SESSION_ACCESS_DENIED";
      return null;
    });
    const view = render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    try {
      await vi.waitFor(() => expect(latestAuth.current?.status).toBe("authenticated"));
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      const saves = invoke.mock.calls.filter(([command]) => command === "auth_save_session");
      expect(saves.length).toBeGreaterThan(2);
      expect(saves.length).toBeLessThan(10);
      expect(saves.some(([, args]) => args?.allowInteraction)).toBe(false);
      await act(async () => { await latestAuth.current!.signOut(); });
      expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session", { allowInteraction: true });
      const count = invoke.mock.calls.filter(([command]) => command === "auth_save_session").length;
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(count);
    } finally { view.unmount(); vi.useRealTimers(); }
  });

  it("does not schedule recovery when a pending write fails after unmount", async () => {
    vi.useFakeTimers();
    const pending = createDeferred<void>();
    getSession.mockResolvedValue({ data: { session: createSession() } });
    invoke.mockImplementation(async (command: string) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_save_session") { await pending.promise; throw "AUTH_SESSION_ACCESS_DENIED"; }
      return null;
    });
    const view = render(<AuthProvider><CaptureAuth onReady={() => {}} /></AuthProvider>);
    try {
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));
      view.unmount();
      await act(async () => { pending.resolve(); await vi.advanceTimersByTimeAsync(120_000); });
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session")).toHaveLength(1);
    } finally { view.unmount(); vi.useRealTimers(); }
  });


  // Opt-in OS integration: private configuration selects only the synthetic
  // keychain probe on the existing QA host. Ordinary CI needs no SSH account.
  it.skipIf(!process.env.DRIFTY_AUTH_KEYCHAIN_FIXTURE)("recovers the latest real Keychain token pair after an actual lock and unlock", async () => {
    const { readFileSync } = await import("node:fs");
    const { spawn } = await import("node:child_process");
    const config = JSON.parse(readFileSync(process.env.DRIFTY_AUTH_KEYCHAIN_FIXTURE!, "utf8"));
    const native = (operation: string, value?: string): Promise<Record<string, boolean>> => new Promise((resolve, reject) => {
      const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", config.host, "python3", config.bridge], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.resume();
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          const report = JSON.parse(output);
          if (code !== 0 || !report.ok) reject(new Error(report.result?.Err ?? "Native fixture failed"));
          else resolve(report.result.Ok);
        } catch { reject(new Error("Invalid native fixture result")); }
      });
      child.stdin.end(JSON.stringify({ ...config, operation, value }));
    });
    const session = createSession();
    const latest = { ...session, access_token: "synthetic-latest-after-retry", refresh_token: "synthetic-latest-refresh" };
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    let attempts = 0;
    let successful = 0;
    let denied = 0;
    getSession.mockResolvedValue({ data: { session } });
    invoke.mockImplementation(async (command: string, args?: { value: string }) => {
      if (command === "auth_take_pending_deep_links") return [];
      if (command === "auth_save_session") {
        attempts += 1;
        try { await native("fixture-write", args!.value); successful += 1; }
        catch (error) { if (String(error).includes("AUTH_SESSION_ACCESS_DENIED")) denied += 1; throw error; }
      }
      if (command === "auth_clear_saved_session") await native("fixture-clear");
      return null;
    });
    await native("fixture-unlock");
    const view = render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    try {
      await waitFor(() => expect(successful).toBe(1), { timeout: 8_000 });
      expect(await native("fixture-lock")).toEqual({ locked: true });
      act(() => authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "synthetic-locked-old", refresh_token: "synthetic-locked-refresh" }));
      await waitFor(() => expect(denied).toBe(1), { timeout: 8_000 });
      act(() => authMocks.authChangeHandler?.("TOKEN_REFRESHED", { ...session, access_token: "synthetic-newer-while-locked" }));
      // At least one scheduled retry fails against the actually locked keychain.
      await waitFor(() => expect(denied).toBeGreaterThanOrEqual(2), { timeout: 8_000 });
      act(() => authMocks.authChangeHandler?.("TOKEN_REFRESHED", latest));
      expect(await native("fixture-unlock")).toEqual({ unlocked: true });
      await waitFor(() => expect(successful).toBe(2), { timeout: 12_000 });
      const expected = JSON.stringify({ accessToken: latest.access_token, refreshToken: latest.refresh_token });
      expect(await native("fixture-matches", expected)).toEqual({ matches: true });
      expect(attempts).toBeGreaterThanOrEqual(4);
      expect(invoke.mock.calls.filter(([command]) => command === "auth_save_session").some(([, args]) => args?.allowInteraction)).toBe(false);
      expect(signInWithPassword).not.toHaveBeenCalled();
      await act(async () => { await latestAuth.current!.signOut(); });
      expect(await native("fixture-matches", expected)).toEqual({ matches: false });
    } finally { view.unmount(); await native("fixture-unlock"); }
  }, 45_000);

  it("waits for native session persistence before email sign-in completes", async () => {
    const pendingSave = createDeferred<void>();
    const latestAuth: { current: ReturnType<typeof useAuth> | null } = { current: null };
    const signedInSession = createSession();
    signInWithPassword.mockResolvedValue({ data: { session: signedInSession }, error: null });
    invoke.mockImplementation((command: string) => {
      if (command === "auth_take_pending_deep_links") return Promise.resolve([]);
      if (command === "auth_load_saved_session") return Promise.resolve(null);
      if (command === "auth_save_session") return pendingSave.promise;
      return Promise.resolve(undefined);
    });

    render(<AuthProvider><CaptureAuth onReady={(value) => { latestAuth.current = value; }} /></AuthProvider>);
    await waitFor(() => expect(latestAuth.current?.status).toBe("unauthenticated"));
    let completed = false;
    const signIn = latestAuth.current!.signInWithEmail("person@example.com", "password").then((result) => {
      completed = true;
      return result;
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_save_session", expect.anything()));
    expect(completed).toBe(false);

    await act(async () => {
      pendingSave.resolve();
      await pendingSave.promise;
    });
    await expect(signIn).resolves.toEqual({ error: null });
    expect(completed).toBe(true);
  });
});
