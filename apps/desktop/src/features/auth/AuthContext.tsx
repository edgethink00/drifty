import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  authModePolicy,
  hasBlockingAuthConfigurationError,
  isSupabaseEnabled,
  supabase,
  type DriftyAuthMode,
} from "../../lib/supabase/client";
import { identifyPostHogUser } from "../../lib/analytics/posthog";
import {
  getAuthDiagnosticError,
  getDesktopSessionDiagnosticSummary,
  getSessionDiagnosticSummary,
  recordAuthDiagnostic,
} from "./authDiagnostics";
import type { User, Session } from "@supabase/supabase-js";

const DESKTOP_LOGIN_URL = "https://drifty.so/auth/login/";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type OAuthCallbackPhase = "waiting" | "received" | "exchanging" | "completed" | "failed";

export interface OAuthCallbackStatus {
  phase: OAuthCallbackPhase;
  message: string;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  status: AuthStatus;
  callbackStatus: OAuthCallbackStatus | null;
  isEnabled: boolean;
  authMode: DriftyAuthMode;
  isAuthRequired: boolean;
  allowsAnonymousAuth: boolean;
  hasRequiredAccountAuth: boolean;
  hasBlockingAuthConfigurationError: boolean;
  signInWithWebsite: () => Promise<{ error: Error | null }>;
  signInAnonymously: () => Promise<{ error: Error | null; user: User | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>;
  clearCallbackStatus: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function getCallbackParam(searchParams: URLSearchParams, hashParams: URLSearchParams, name: string) {
  return searchParams.get(name) ?? hashParams.get(name);
}

function getOAuthCallbackErrorMessage(error: string, description: string | null) {
  return description?.trim() || error;
}

function getOAuthSessionCallbackErrorMessage(error: string) {
  if (/auth session missing/i.test(error) || /token/i.test(error)) {
    return "That sign-in link was incomplete or expired. Please sign in again on drifty.so.";
  }

  return error;
}

type OAuthCallbackResult =
  | { kind: "code"; code: string }
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "error"; message: string }
  | null;

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

type DesktopAuthSession = {
  accessToken: string;
  refreshToken: string;
};

function serializeDesktopAuthSession(session: Session): string {
  return JSON.stringify({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });
}

function parseDesktopAuthSession(value: string | null): DesktopAuthSession | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.accessToken !== "string" || typeof record.refreshToken !== "string") return null;
    return { accessToken: record.accessToken, refreshToken: record.refreshToken };
  } catch {
    return null;
  }
}

function getOAuthCallbackResultFromUrl(value: string, source: "web" | "tauri"): OAuthCallbackResult {
  try {
    const url = new URL(value);
    const isWebCallback = source === "web" && ["/auth/callback", "/auth/callback/"].includes(url.pathname);
    const isTauriCallback = source === "tauri" && url.protocol === "drifty:" && url.hostname === "auth" && ["/callback", "/callback/"].includes(url.pathname);

    if (!isWebCallback && !isTauriCallback) {
      return null;
    }

    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    const error = getCallbackParam(url.searchParams, hashParams, "error");
    if (error) {
      return {
        kind: "error",
        message: `OAuth callback failed: ${getOAuthCallbackErrorMessage(error, getCallbackParam(url.searchParams, hashParams, "error_description"))}`,
      };
    }

    const code = getCallbackParam(url.searchParams, hashParams, "code");
    if (code) {
      return { kind: "code", code };
    }

    const accessToken = getCallbackParam(url.searchParams, hashParams, "access_token");
    const refreshToken = getCallbackParam(url.searchParams, hashParams, "refresh_token");
    if (accessToken && refreshToken) {
      return { kind: "session", accessToken, refreshToken };
    }

    return {
      kind: "error",
      message: "OAuth callback did not include a sign-in code or session tokens.",
    };
  } catch {
    return null;
  }
}

function isBillingSuccessDeepLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "drifty:" && url.hostname === "billing" && ["/success", "/success/"].includes(url.pathname);
  } catch {
    return false;
  }
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function isAnonymousSupabaseUser(user: User | null): boolean {
  return user?.is_anonymous === true;
}

export function hasRequiredAccountAuth(user: User | null): boolean {
  return Boolean(user) && !isAnonymousSupabaseUser(user);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [callbackStatus, setCallbackStatus] = useState<OAuthCallbackStatus | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const tauriInvokeRef = useRef<TauriInvoke | null>(null);
  const saveSequenceRef = useRef(0);

  function applySessionState(nextSession: Session | null) {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setStatus(nextSession?.user ? "authenticated" : "unauthenticated");
    identifyPostHogUser(nextSession?.user ?? null);
  }

  const saveDesktopSession = async (nextSession: Session | null) => {
    const invoke = tauriInvokeRef.current;
    const saveId = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveId;
    recordAuthDiagnostic("auth.native_save.start", {
      saveId,
      operation: nextSession ? "save" : "clear",
      ...getSessionDiagnosticSummary(nextSession),
    });
    if (!invoke) {
      recordAuthDiagnostic("auth.native_save.skipped", {
        saveId,
        operation: nextSession ? "save" : "clear",
        reason: "tauri-unavailable",
      });
      return;
    }
    try {
      if (nextSession) {
        await invoke<void>("auth_save_session", { value: serializeDesktopAuthSession(nextSession) });
      } else {
        await invoke<void>("auth_clear_saved_session");
      }
      recordAuthDiagnostic("auth.native_save.success", {
        saveId,
        operation: nextSession ? "save" : "clear",
        ...getSessionDiagnosticSummary(nextSession),
      });
    } catch (error) {
      recordAuthDiagnostic("auth.native_save.error", {
        saveId,
        operation: nextSession ? "save" : "clear",
        ...getAuthDiagnosticError(error),
      });
      console.warn("Unable to persist desktop auth session.", error);
    }
  };

  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase) {
      setStatus("unauthenticated");
      return;
    }

    const client = supabase;
    const exchangedCodes = new Set<string>();
    const appliedSessionCallbacks = new Set<string>();
    let isActive = true;

    recordAuthDiagnostic("auth.provider.start", {
      authMode: authModePolicy.mode,
      isAuthRequired: authModePolicy.isAuthRequired,
      allowsAnonymousAuth: authModePolicy.allowsAnonymousAuth,
      runtime: isTauriRuntime() ? "tauri" : "web",
    });

    const restoreDesktopSession = async () => {
      const invoke = tauriInvokeRef.current;
      if (!invoke) {
        recordAuthDiagnostic("auth.restore.skipped", { reason: "tauri-unavailable" });
        return null;
      }
      recordAuthDiagnostic("auth.restore.load.start", { source: "native" });
      try {
        const savedValue = await invoke<string | null>("auth_load_saved_session");
        const savedSession = parseDesktopAuthSession(savedValue);
        recordAuthDiagnostic("auth.restore.load.complete", {
          source: "native",
          hasSavedSession: savedValue !== null,
          ...getDesktopSessionDiagnosticSummary(savedSession),
        });
        if (!savedSession) {
          recordAuthDiagnostic("auth.restore.empty", {
            source: "native",
            hasSavedSession: savedValue !== null,
          });
          return null;
        }

        recordAuthDiagnostic("auth.restore.set_session.start", {
          source: "native",
          ...getDesktopSessionDiagnosticSummary(savedSession),
        });
        const { data, error } = await client.auth.setSession({
          access_token: savedSession.accessToken,
          refresh_token: savedSession.refreshToken,
        });

        if (error || !data.session) {
          recordAuthDiagnostic("auth.restore.set_session.error", {
            source: "native",
            ...getAuthDiagnosticError(error ?? new Error("No session returned from setSession")),
          });
          await saveDesktopSession(null);
          return null;
        }

        recordAuthDiagnostic("auth.restore.set_session.success", {
          source: "native",
          ...getSessionDiagnosticSummary(data.session),
        });
        return data.session;
      } catch (error) {
        recordAuthDiagnostic("auth.restore.error", {
          source: "native",
          ...getAuthDiagnosticError(error),
        });
        console.warn("Unable to restore desktop auth session.", error);
        return null;
      }
    };

    const applySession = (nextSession: Session | null) => {
      if (!isActive) {
        return;
      }

      applySessionState(nextSession);
    };

    const clearSession = () => {
      applySession(null);
    };

    const setCallbackReceived = () => {
      setCallbackStatus({
        phase: "received",
        message: "OAuth callback received.",
      });
    };

    const setCallbackExchanging = (message: string) => {
      setCallbackStatus({
        phase: "exchanging",
        message,
      });
    };

    const setCallbackCompleted = () => {
      setCallbackStatus({
        phase: "completed",
        message: "OAuth callback completed.",
      });
    };

    const setCallbackFailed = (message: string) => {
      setCallbackStatus({
        phase: "failed",
        message,
      });
    };

    const exchangeAuthCode = async (authCode: string) => {
      if (exchangedCodes.has(authCode)) {
        recordAuthDiagnostic("auth.callback.code.duplicate", { callbackKind: "code" });
        return true;
      }

      exchangedCodes.add(authCode);
      const previousSession = sessionRef.current;
      setCallbackReceived();
      setCallbackExchanging("Exchanging OAuth authorization code.");
      const { data, error } = await client.auth.exchangeCodeForSession(authCode);
      if (error) {
        exchangedCodes.delete(authCode);
        recordAuthDiagnostic("auth.callback.code.error", {
          callbackKind: "code",
          ...getAuthDiagnosticError(error),
        });
        setCallbackFailed(`OAuth authorization code exchange failed: ${error.message}`);
        applySession(previousSession);
        return true;
      }

      const exchangedSession = data?.session ?? (await client.auth.getSession()).data.session;
      if (!exchangedSession) {
        recordAuthDiagnostic("auth.callback.code.no_session", { callbackKind: "code" });
        setCallbackFailed("OAuth authorization code was accepted, but no Supabase session was available.");
        applySession(previousSession);
        return true;
      }

      recordAuthDiagnostic("auth.callback.code.success", {
        callbackKind: "code",
        ...getSessionDiagnosticSummary(exchangedSession),
      });
      applySession(exchangedSession);
      await saveDesktopSession(exchangedSession);
      setCallbackCompleted();

      return true;
    };

    const handleAuthCallbackUrl = async (url: string, source: "web" | "tauri") => {
      const callbackResult = getOAuthCallbackResultFromUrl(url, source);
      if (!callbackResult) {
        return false;
      }

      recordAuthDiagnostic("auth.callback.detected", {
        callbackKind: callbackResult.kind,
        source,
      });

      if (callbackResult.kind === "error") {
        recordAuthDiagnostic("auth.callback.error", {
          callbackKind: "error",
          errorMessage: callbackResult.message,
          source,
        });
        setCallbackFailed(callbackResult.message);
        return true;
      }

      if (callbackResult.kind === "code") {
        return exchangeAuthCode(callbackResult.code);
      }

      if (callbackResult.kind === "session") {
        const sessionCallbackKey = `${callbackResult.accessToken}:${callbackResult.refreshToken}`;
        if (appliedSessionCallbacks.has(sessionCallbackKey)) {
          recordAuthDiagnostic("auth.callback.session.duplicate", { callbackKind: "session", source });
          return true;
        }
        appliedSessionCallbacks.add(sessionCallbackKey);
      }

      const previousSession = sessionRef.current;
      setCallbackReceived();
      setCallbackExchanging("Applying OAuth session.");

      const { data, error } = await client.auth.setSession({
        access_token: callbackResult.accessToken,
        refresh_token: callbackResult.refreshToken,
      });

      const callbackSession = data?.session ?? (await client.auth.getSession()).data.session;
      if (error || !callbackSession) {
        recordAuthDiagnostic("auth.callback.session.error", {
          callbackKind: "session",
          source,
          ...getAuthDiagnosticError(error ?? new Error("OAuth session callback did not return a session")),
        });
        setCallbackFailed(error ? getOAuthSessionCallbackErrorMessage(error.message) : "OAuth session callback did not return a session.");
        applySession(previousSession);
        return true;
      }

      recordAuthDiagnostic("auth.callback.session.success", {
        callbackKind: "session",
        source,
        ...getSessionDiagnosticSummary(callbackSession),
      });
      applySession(callbackSession);
      await saveDesktopSession(callbackSession);
      setCallbackCompleted();
      return true;
    };

    const handleAuthCallbackUrls = async (urls: string[]) => {
      for (const url of urls) {
        if (isBillingSuccessDeepLink(url)) {
          window.dispatchEvent(new CustomEvent("drifty:billing-success"));
          continue;
        }
        await handleAuthCallbackUrl(url, "tauri");
      }
    };

    let unlistenDeepLink: (() => void) | null = null;
    let pendingDeepLinkInterval: number | null = null;

    const initializeAuth = async () => {
      recordAuthDiagnostic("auth.init.start", { runtime: isTauriRuntime() ? "tauri" : "web" });
      const handledWebCallback = await handleAuthCallbackUrl(window.location.href, "web");

      if (handledWebCallback) {
        window.history.replaceState({}, document.title, window.location.origin);
      }

      if (isTauriRuntime()) {
        recordAuthDiagnostic("auth.init.tauri_detected", { runtime: "tauri" });
        const [{ invoke }, { getCurrent, onOpenUrl }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/plugin-deep-link"),
        ]);
        tauriInvokeRef.current = invoke;
        const handlePendingDeepLinkUrls = async () => {
          try {
            const pendingUrls = await invoke<string[]>("auth_take_pending_deep_links");
            recordAuthDiagnostic("auth.pending_deep_links.loaded", {
              pendingUrlCount: pendingUrls.length,
            });
            if (pendingUrls.length > 0) {
              await handleAuthCallbackUrls(pendingUrls);
            }
          } catch (error) {
            recordAuthDiagnostic("auth.pending_deep_links.error", getAuthDiagnosticError(error));
            console.warn("Unable to read pending desktop auth callbacks.", error);
          }
        };

        const currentUrls = await getCurrent();
        if (currentUrls) {
          await handleAuthCallbackUrls(currentUrls);
        }

        const nextUnlistenDeepLink = await onOpenUrl((urls) => {
          void handleAuthCallbackUrls(urls);
        });
        await handlePendingDeepLinkUrls();
        pendingDeepLinkInterval = window.setInterval(() => {
          void handlePendingDeepLinkUrls();
        }, 1000);

        if (isActive) {
          unlistenDeepLink = nextUnlistenDeepLink;
        } else {
          nextUnlistenDeepLink();
        }
      }

      const restoredSession = await restoreDesktopSession();
      if (restoredSession) {
        recordAuthDiagnostic("auth.init.complete", {
          source: "native",
          ...getSessionDiagnosticSummary(restoredSession),
        });
        applySession(restoredSession);
        return;
      }

      recordAuthDiagnostic("auth.get_session.start", { source: "supabase-storage" });
      const { data: { session } } = await client.auth.getSession();
      recordAuthDiagnostic("auth.get_session.complete", {
        source: "supabase-storage",
        ...getSessionDiagnosticSummary(session),
      });
      applySession(session);
      await saveDesktopSession(session);
      recordAuthDiagnostic("auth.init.complete", {
        source: "supabase-storage",
        ...getSessionDiagnosticSummary(session),
      });
    };

    void initializeAuth().catch((error) => {
      recordAuthDiagnostic("auth.init.error", getAuthDiagnosticError(error));
      console.warn("Unable to initialize auth.", error);
      if (isActive) {
        clearSession();
      }
    });

    const { data: { subscription } } = client.auth.onAuthStateChange(
      (event, session) => {
        recordAuthDiagnostic("auth.state_change", {
          eventType: event,
          ...getSessionDiagnosticSummary(session),
        });
        applySession(session);
        void saveDesktopSession(session);
      }
    );

    return () => {
      isActive = false;
      unlistenDeepLink?.();
      if (pendingDeepLinkInterval !== null) {
        window.clearInterval(pendingDeepLinkInterval);
      }
      subscription.unsubscribe();
    };
  }, []);

  async function signInWithEmail(email: string, password: string) {
    if (!supabase) {
      return { error: new Error("Supabase is not configured") };
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  }

  async function signInAnonymously() {
    if (!authModePolicy.allowsAnonymousAuth) {
      return { error: new Error("Sign in is required before joining the leaderboard."), user: null };
    }

    if (!supabase) {
      return { error: new Error("Supabase is not configured"), user: null };
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      return { error, user: null };
    }

    const nextSession = data.session ?? (await supabase.auth.getSession()).data.session;
    if (nextSession) {
      recordAuthDiagnostic("auth.anonymous_sign_in.success", getSessionDiagnosticSummary(nextSession));
      applySessionState(nextSession);
      await saveDesktopSession(nextSession);
    }

    return { error: null, user: nextSession?.user ?? data.user ?? null };
  }

  async function signUpWithEmail(email: string, password: string) {
    if (!supabase) {
      return { error: new Error("Supabase is not configured"), needsEmailConfirmation: false };
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    const needsEmailConfirmation = !data.session && !error;
    return { error, needsEmailConfirmation };
  }

  function clearCallbackStatus() {
    setCallbackStatus(null);
  }

  async function signInWithWebsite() {
    if (!supabase) {
      return { error: new Error("Supabase is not configured") };
    }
    const isDesktop = isTauriRuntime();

    setCallbackStatus({
      phase: "waiting",
      message: isDesktop
        ? "Opening drifty.so in your browser. Sign in there, then choose Open Drifty."
        : "Opening drifty.so sign-in.",
    });

    if (isDesktop) {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(DESKTOP_LOGIN_URL);
        setCallbackStatus({
          phase: "waiting",
          message: "Browser opened. Complete sign-in on drifty.so, then choose Open Drifty.",
        });
      } catch (error) {
        const openError = error instanceof Error
          ? error
          : new Error("Unable to open drifty.so sign-in");
        setCallbackStatus({
          phase: "failed",
          message: openError.message,
        });
        return { error: openError };
      }

      return { error: null };
    }

    window.location.assign(DESKTOP_LOGIN_URL);
    return { error: null };
  }

  async function signOut() {
    if (!supabase) return;
    recordAuthDiagnostic("auth.sign_out.start", getSessionDiagnosticSummary(sessionRef.current));
    await supabase.auth.signOut();
    applySessionState(null);
    await saveDesktopSession(null);
    recordAuthDiagnostic("auth.sign_out.complete", { hasSession: false });
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        status,
        callbackStatus,
        isEnabled: isSupabaseEnabled(),
        authMode: authModePolicy.mode,
        isAuthRequired: authModePolicy.isAuthRequired,
        allowsAnonymousAuth: authModePolicy.allowsAnonymousAuth,
        hasRequiredAccountAuth: hasRequiredAccountAuth(user),
        hasBlockingAuthConfigurationError: hasBlockingAuthConfigurationError(),
        signInWithWebsite,
        signInAnonymously,
        signInWithEmail,
        signUpWithEmail,
        clearCallbackStatus,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
