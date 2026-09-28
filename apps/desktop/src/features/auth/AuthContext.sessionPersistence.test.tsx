// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthChangeHandler = (event: string, session: Session | null) => void;

const { authMocks, getSession, onAuthStateChange, setSession, signInWithPassword, invoke } = vi.hoisted(() => {
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
      signOut: vi.fn().mockResolvedValue({ error: null }),
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
