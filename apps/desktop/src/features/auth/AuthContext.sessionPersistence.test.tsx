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
    expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session");
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
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("auth_clear_saved_session"));
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
