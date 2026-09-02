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
  clearGoogleOAuthVerifier,
  exchangeGoogleOAuthCodeForSession,
  getGoogleOAuthAuthorizeUrl,
  hasBlockingAuthConfigurationError,
  hasUsableGoogleOAuthVerifier,
  isSupabaseEnabled,
  prepareGoogleOAuthAuthorization,
  supabase,
  type DriftyAuthMode,
} from "../../lib/supabase/client";
import { capturePostHogEvent, recordPostHogAuthState, toAnalyticsErrorKind } from "../../lib/analytics/posthogClient";
import {
  getAuthDiagnosticError,
  getDesktopSessionDiagnosticSummary,
  getSessionDiagnosticSummary,
  recordAuthDiagnostic,
} from "./authDiagnostics";
import {
  parseDesktopAuthSession,
  serializeDesktopAuthSession,
  type SaveDesktopSessionOptions,
} from "./desktopAuthSession";
import {
  AUTH_INITIALIZATION_TIMEOUT_MS,
  type AuthConnectionStatus,
} from "./authConnectionStatus";
import { getOAuthCallbackResultFromUrl } from "./authCallback";
import { normalizeAuthPasswordError, validateAuthPasswordForSignUp } from "./authPasswordPolicy";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { dispatchTeamInviteDeepLink } from "../team/teamInviteDeepLinks";
import { readBillingSuccessDeepLink, storePendingPromoHandoff } from "../billing/promoHandoff";
import {
  authorizeGoogleCalendar,
  discardPendingGoogleCalendarConnection,
  finalizeGoogleCalendarConnection,
  getGoogleCalendarCapability,
  isGoogleCalendarAuthorizationCancelled,
  isGoogleCalendarOnboardingEnabled,
  notifyGoogleCalendarConnectionChanged,
} from "../calendar/googleCalendarClient";
import type { User, Session } from "@supabase/supabase-js";

const DESKTOP_LOGIN_URL = "https://drifty.so/auth/login/";
const DESKTOP_EMAIL_AUTH_BRIDGE_URL = "https://drifty.so/auth/callback/";
const DESKTOP_GOOGLE_AUTH_BRIDGE_URL = "https://drifty.so/auth/desktop-google-callback/";
const GOOGLE_BROWSER_OPENED_MESSAGE = "Browser opened. Waiting for sign-in to return to Drifty.";
const GOOGLE_BROWSER_OPEN_FAILED_MESSAGE = "Unable to open Google sign-in. Try again, or continue with email.";
const GOOGLE_BROWSER_REOPENING_MESSAGE = "Reopening Google sign-in...";
const GOOGLE_OAUTH_REQUEST_TIMEOUT_MESSAGE = "Google sign-in took too long. Try again, or continue with email.";
const GOOGLE_OAUTH_REQUEST_FAILED_MESSAGE = "Unable to start Google sign-in. Try again, or continue with email.";
const GOOGLE_OAUTH_CALLBACK_FAILED_MESSAGE = "Google sign-in could not be completed. Try again.";
const GOOGLE_OAUTH_CALLBACK_CANCELLED_MESSAGE = "That Google sign-in attempt expired or was cancelled. Start Google sign-in again.";
const GOOGLE_CALENDAR_CANCELLED_MESSAGE = "Google sign-in was cancelled. You can try again or continue with email.";
const GOOGLE_CALENDAR_CONNECTED_MESSAGE = "Signed in. Google Calendar is connected.";
const GOOGLE_CALENDAR_SKIPPED_MESSAGE = "Signed in. Google Calendar was skipped and can be connected later.";
const GOOGLE_CALENDAR_FALLBACK_MESSAGE = "Calendar setup is unavailable. Opening standard Google sign-in...";
const GOOGLE_CALENDAR_IDENTITY_MISMATCH_MESSAGE = "Google sign-in could not be verified. Please try again.";
const GOOGLE_SIGN_IN_EXPIRED_MESSAGE = "Google sign-in expired after 5 minutes. Try again.";
const GOOGLE_OAUTH_URL_MAX_LENGTH = 8_192;
const GOOGLE_OAUTH_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS = 5 * 60 * 1000;
export const GOOGLE_OAUTH_OPERATION_TIMEOUT_MS = 20 * 1000;

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type OAuthCallbackPhase = "waiting" | "received" | "exchanging" | "completed" | "failed";
export type OAuthCallbackMethod = "google" | "website";
export type GoogleSignInAction = "opening" | "reopen" | "retry";

export interface GoogleSignInOptions {
  readonly requestCalendar?: boolean;
}

export interface OAuthCallbackStatus {
  phase: OAuthCallbackPhase;
  message: string;
  method?: OAuthCallbackMethod;
  googleAction?: GoogleSignInAction;
}

interface GoogleOAuthAttempt {
  id: number;
  url: string;
  expiresAt: number;
}

interface GoogleOAuthOperationHandle {
  id: number;
  cancel: () => void;
}

class GoogleOAuthOperationTimeoutError extends Error {
  constructor() {
    super("Google OAuth operation timed out");
    this.name = "GoogleOAuthOperationTimeoutError";
  }
}

class GoogleOAuthOperationCancelledError extends Error {
  constructor() {
    super("Google OAuth operation cancelled");
    this.name = "GoogleOAuthOperationCancelledError";
  }
}

class GoogleCalendarIdentityMismatchError extends Error {
  constructor() {
    super(GOOGLE_CALENDAR_IDENTITY_MISMATCH_MESSAGE);
    this.name = "GoogleCalendarIdentityMismatchError";
  }
}

function withGoogleOAuthOperationTimeout<T>(
  operation: PromiseLike<T>,
  cancellation?: Promise<void>,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      reject(new GoogleOAuthOperationTimeoutError());
    }, GOOGLE_OAUTH_OPERATION_TIMEOUT_MS);

    Promise.resolve(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );

    cancellation?.then(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      reject(new GoogleOAuthOperationCancelledError());
    });
  });
}

function isValidGoogleOAuthUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > GOOGLE_OAUTH_URL_MAX_LENGTH) {
    return false;
  }

  try {
    const url = new URL(value);
    const expectedAuthorizeUrl = getGoogleOAuthAuthorizeUrl();
    if (!expectedAuthorizeUrl) return false;
    const expected = new URL(expectedAuthorizeUrl);
    const provider = url.searchParams.getAll("provider");
    const redirectTo = url.searchParams.getAll("redirect_to");
    const challenge = url.searchParams.getAll("code_challenge");
    const challengeMethod = url.searchParams.getAll("code_challenge_method");
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.origin === expected.origin
      && url.pathname === expected.pathname
      && url.hash === ""
      && provider.length === 1
      && provider[0] === "google"
      && redirectTo.length === 1
      && redirectTo[0] === DESKTOP_GOOGLE_AUTH_BRIDGE_URL
      && challenge.length === 1
      && GOOGLE_OAUTH_CHALLENGE_PATTERN.test(challenge[0])
      && challengeMethod.length === 1
      && challengeMethod[0] === "s256";
  } catch {
    return false;
  }
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  status: AuthStatus;
  cloudConnectionStatus: AuthConnectionStatus;
  callbackStatus: OAuthCallbackStatus | null;
  isEnabled: boolean;
  authMode: DriftyAuthMode;
  isAuthRequired: boolean;
  allowsAnonymousAuth: boolean;
  hasRequiredAccountAuth: boolean;
  hasBlockingAuthConfigurationError: boolean;
  signInWithWebsite: () => Promise<{ error: Error | null }>;
  signInWithGoogle: (options?: GoogleSignInOptions) => Promise<{ error: Error | null }>;
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

function getOAuthSessionCallbackErrorMessage(error: string) {
  if (/auth session missing/i.test(error) || /token/i.test(error)) {
    return "That sign-in link was incomplete or expired. Please sign in again on drifty.so.";
  }

  return "Sign-in could not be completed. Try again.";
}

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

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
  const [cloudConnectionStatus, setCloudConnectionStatus] = useState<AuthConnectionStatus>(
    isSupabaseEnabled() ? "checking" : "disabled",
  );
  const [callbackStatus, setCallbackStatus] = useState<OAuthCallbackStatus | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const tauriInvokeRef = useRef<TauriInvoke | null>(null);
  const saveSequenceRef = useRef(0);
  const googleOAuthAttemptSequenceRef = useRef(0);
  const googleOAuthAttemptRef = useRef<GoogleOAuthAttempt | null>(null);
  const googleOAuthExpiryTimeoutRef = useRef<number | null>(null);
  const googleOAuthOperationSequenceRef = useRef(0);
  const googleOAuthActiveOperationRef = useRef<GoogleOAuthOperationHandle | null>(null);
  const googleCalendarOAuthInFlightRef = useRef(false);

  function cancelPendingGoogleOAuthOperation() {
    googleOAuthActiveOperationRef.current?.cancel();
    googleOAuthOperationSequenceRef.current += 1;
    googleOAuthActiveOperationRef.current = null;
  }

  function clearGoogleOAuthAttempt({
    cancelPending = true,
    clearPersistedVerifier = true,
  }: {
    cancelPending?: boolean;
    clearPersistedVerifier?: boolean;
  } = {}) {
    if (cancelPending) {
      cancelPendingGoogleOAuthOperation();
    }
    if (googleOAuthExpiryTimeoutRef.current !== null) {
      window.clearTimeout(googleOAuthExpiryTimeoutRef.current);
      googleOAuthExpiryTimeoutRef.current = null;
    }
    googleOAuthAttemptRef.current = null;
    if (clearPersistedVerifier) {
      clearGoogleOAuthVerifier();
    }
  }

  function expireGoogleOAuthAttempt(attemptId: number, { cancelPending = true }: { cancelPending?: boolean } = {}) {
    if (googleOAuthAttemptRef.current?.id !== attemptId) {
      return;
    }

    if (cancelPending) {
      cancelPendingGoogleOAuthOperation();
    }

    googleOAuthAttemptRef.current = null;
    googleOAuthExpiryTimeoutRef.current = null;
    clearGoogleOAuthVerifier();
    recordAuthDiagnostic("auth.google_oauth.timeout", {
      reason: "oauth-state-expired",
      timeoutMs: GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS,
    });
    setCallbackStatus((current) => {
      if (sessionRef.current?.user || current?.method !== "google") {
        return current;
      }
      return {
        phase: "failed",
        message: GOOGLE_SIGN_IN_EXPIRED_MESSAGE,
        method: "google",
        googleAction: "retry",
      };
    });
    capturePostHogEvent("cloud_auth_action", {
      action: "sign_in_completed",
      method: "oauth",
      result: "error",
      error_kind: "timeout",
    });
  }

  function rememberGoogleOAuthAttempt(url: string, expiresAt: number) {
    clearGoogleOAuthAttempt({ cancelPending: false, clearPersistedVerifier: false });
    const attempt = {
      id: googleOAuthAttemptSequenceRef.current + 1,
      url,
      expiresAt,
    };
    googleOAuthAttemptSequenceRef.current = attempt.id;
    googleOAuthAttemptRef.current = attempt;
    googleOAuthExpiryTimeoutRef.current = window.setTimeout(() => {
      expireGoogleOAuthAttempt(attempt.id);
    }, Math.max(0, attempt.expiresAt - Date.now()));
    return attempt;
  }

  function applySessionState(nextSession: Session | null, nextCloudConnectionStatus: AuthConnectionStatus = "online") {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setStatus(nextSession?.user ? "authenticated" : "unauthenticated");
    setCloudConnectionStatus(nextCloudConnectionStatus);
    recordPostHogAuthState(nextSession?.user ?? null);
  }

  const saveDesktopSession = async (nextSession: Session | null, options: SaveDesktopSessionOptions = {}) => {
    const invoke = tauriInvokeRef.current;
    const saveId = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveId;
    const operation = nextSession ? "save" : "clear";
    recordAuthDiagnostic("auth.native_save.start", {
      saveId,
      operation,
      ...getSessionDiagnosticSummary(nextSession),
    });
    if (!nextSession && options.allowClear === false) {
      recordAuthDiagnostic("auth.native_save.skipped", {
        saveId,
        operation,
        reason: options.skipReason ?? "native-restore-failed",
      });
      return;
    }
    if (!invoke) {
      recordAuthDiagnostic("auth.native_save.skipped", {
        saveId,
        operation,
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
        operation,
        ...getSessionDiagnosticSummary(nextSession),
      });
    } catch (error) {
      recordAuthDiagnostic("auth.native_save.error", {
        saveId,
        operation,
        ...getAuthDiagnosticError(error),
      });
      console.warn("Unable to persist desktop auth session.", error);
    }
  };

  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase) {
      setStatus("unauthenticated");
      setCloudConnectionStatus("disabled");
      recordPostHogAuthState(null);
      return;
    }

    const client = supabase;
    const exchangedCodes = new Set<string>();
    const appliedSessionCallbacks = new Set<string>();
    let isActive = true;
    let isInitializingAuth = true;
    let initializationTimeout: number | null = null;
    let preserveNativeSessionAfterRestoreFailure = false;

    setCloudConnectionStatus("checking");

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
          preserveNativeSessionAfterRestoreFailure = true;
          await saveDesktopSession(null, {
            allowClear: false,
            skipReason: "native-restore-failed",
          });
          return null;
        }

        recordAuthDiagnostic("auth.restore.set_session.success", {
          source: "native",
          ...getSessionDiagnosticSummary(data.session),
        });
        return data.session;
      } catch (error) {
        preserveNativeSessionAfterRestoreFailure = true;
        recordAuthDiagnostic("auth.restore.error", {
          source: "native",
          ...getAuthDiagnosticError(error),
        });
        console.warn("Unable to restore desktop auth session.", error);
        return null;
      }
    };

    const applySession = (nextSession: Session | null, nextCloudConnectionStatus: AuthConnectionStatus = "online") => {
      if (!isActive) {
        return;
      }

      applySessionState(nextSession, nextCloudConnectionStatus);
    };

    const clearSession = (nextCloudConnectionStatus: AuthConnectionStatus = "online") => {
      applySession(null, nextCloudConnectionStatus);
    };

    const clearInitializationTimeout = () => {
      if (initializationTimeout === null) {
        return;
      }

      window.clearTimeout(initializationTimeout);
      initializationTimeout = null;
    };

    initializationTimeout = window.setTimeout(() => {
      if (!isActive || !isInitializingAuth || sessionRef.current) {
        return;
      }

      recordAuthDiagnostic("auth.init.timeout", {
        reason: "initialization-timeout",
        timeoutMs: AUTH_INITIALIZATION_TIMEOUT_MS,
      });
      clearSession("offline");
    }, AUTH_INITIALIZATION_TIMEOUT_MS);

    const setCallbackReceived = (method: OAuthCallbackMethod) => {
      setCallbackStatus({
        phase: "received",
        message: "OAuth callback received.",
        method,
      });
    };

    const setCallbackExchanging = (message: string, method: OAuthCallbackMethod) => {
      setCallbackStatus({
        phase: "exchanging",
        message,
        method,
      });
    };

    const setCallbackCompleted = (method: OAuthCallbackMethod) => {
      setCallbackStatus({
        phase: "completed",
        message: "OAuth callback completed.",
        method,
      });
    };

    const setCallbackFailed = (message: string, method?: OAuthCallbackMethod) => {
      setCallbackStatus({
        phase: "failed",
        message,
        method,
        ...(method === "google" ? { googleAction: "retry" as const } : {}),
      });
    };

    const exchangeAuthCode = async (authCode: string, method: OAuthCallbackMethod) => {
      if (exchangedCodes.has(authCode)) {
        recordAuthDiagnostic("auth.callback.code.duplicate", { callbackKind: "code" });
        return true;
      }

      if (method === "google" && !hasUsableGoogleOAuthVerifier()) {
        recordAuthDiagnostic("auth.callback.code.rejected", {
          callbackKind: "code",
          reason: "missing-expired-or-cancelled-verifier",
        });
        setCallbackFailed(GOOGLE_OAUTH_CALLBACK_CANCELLED_MESSAGE, method);
        return true;
      }

      exchangedCodes.add(authCode);
      const previousSession = sessionRef.current;
      let googleOperationId: number | null = null;
      let googleAbortController: AbortController | null = null;
      let googleOperationCancellation: Promise<void> | undefined;

      if (method === "google") {
        googleOperationId = googleOAuthOperationSequenceRef.current + 1;
        googleOAuthOperationSequenceRef.current = googleOperationId;
        googleAbortController = new AbortController();
        let cancelOperation: () => void = () => undefined;
        googleOperationCancellation = new Promise<void>((resolve) => {
          cancelOperation = () => {
            if (!googleAbortController?.signal.aborted) {
              googleAbortController?.abort(new GoogleOAuthOperationCancelledError());
            }
            resolve();
          };
        });
        googleOAuthActiveOperationRef.current = {
          id: googleOperationId,
          cancel: cancelOperation,
        };
      }

      const isCurrentGoogleOperation = () => method !== "google"
        || googleOAuthActiveOperationRef.current?.id === googleOperationId;
      setCallbackReceived(method);
      setCallbackExchanging("Exchanging OAuth authorization code.", method);
      try {
        const { data, error } = method === "google"
          ? await withGoogleOAuthOperationTimeout(
              exchangeGoogleOAuthCodeForSession(authCode, googleAbortController!.signal),
              googleOperationCancellation,
              () => googleAbortController?.abort(new GoogleOAuthOperationTimeoutError()),
            )
          : await client.auth.exchangeCodeForSession(authCode);
        if (!isActive || !isCurrentGoogleOperation()) {
          return true;
        }
        if (error) {
          exchangedCodes.delete(authCode);
          recordAuthDiagnostic("auth.callback.code.error", {
            callbackKind: "code",
            ...getAuthDiagnosticError(error),
          });
          setCallbackFailed(
            method === "google"
              ? GOOGLE_OAUTH_CALLBACK_FAILED_MESSAGE
              : "Sign-in could not be completed. Try again.",
            method,
          );
          applySession(previousSession);
          capturePostHogEvent("cloud_auth_action", {
            action: "sign_in_completed",
            method: "oauth",
            result: "error",
            error_kind: toAnalyticsErrorKind(error),
          });
          return true;
        }

        const exchangedSession = data?.session ?? (
          method === "website" ? (await client.auth.getSession()).data.session : null
        );
        if (!exchangedSession) {
          recordAuthDiagnostic("auth.callback.code.no_session", { callbackKind: "code" });
          setCallbackFailed(
            method === "google"
              ? GOOGLE_OAUTH_CALLBACK_FAILED_MESSAGE
              : "Sign-in could not be completed. Try again.",
            method,
          );
          applySession(previousSession);
          capturePostHogEvent("cloud_auth_action", {
            action: "sign_in_completed",
            method: "oauth",
            result: "error",
            error_kind: "not_authenticated",
          });
          return true;
        }

        recordAuthDiagnostic("auth.callback.code.success", {
          callbackKind: "code",
          ...getSessionDiagnosticSummary(exchangedSession),
        });
        if (method === "google") {
          clearGoogleOAuthAttempt({ cancelPending: false });
        }
        applySession(exchangedSession);
        await saveDesktopSession(exchangedSession);
        setCallbackCompleted(method);
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_completed",
          method: "oauth",
          result: "success",
        });

        return true;
      } catch (error) {
        exchangedCodes.delete(authCode);
        if (
          !isActive
          || !isCurrentGoogleOperation()
          || error instanceof GoogleOAuthOperationCancelledError
        ) {
          return true;
        }
        const isTimeout = error instanceof GoogleOAuthOperationTimeoutError;
        recordAuthDiagnostic("auth.callback.code.error", {
          callbackKind: "code",
          reason: isTimeout ? "exchange-timeout" : "exchange-threw",
          ...getAuthDiagnosticError(error),
        });
        setCallbackFailed(
          isTimeout
            ? (method === "google"
                ? GOOGLE_OAUTH_REQUEST_TIMEOUT_MESSAGE
                : "Sign-in took too long. Try again.")
            : (method === "google"
                ? GOOGLE_OAUTH_CALLBACK_FAILED_MESSAGE
                : "Sign-in could not be completed. Try again."),
          method,
        );
        applySession(previousSession);
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_completed",
          method: "oauth",
          result: "error",
          error_kind: isTimeout ? "timeout" : toAnalyticsErrorKind(error),
        });
        return true;
      } finally {
        if (method === "website") {
          clearGoogleOAuthVerifier();
        }
        if (
          method === "google"
          && googleOAuthActiveOperationRef.current?.id === googleOperationId
        ) {
          googleOAuthActiveOperationRef.current = null;
        }
      }
    };

    const handleAuthCallbackUrl = async (url: string, source: "web" | "tauri") => {
      const callbackResult = getOAuthCallbackResultFromUrl(url, source);
      if (!callbackResult) {
        return false;
      }

      if (callbackResult.kind === "code" && callbackResult.method === "google") {
        cancelPendingGoogleOAuthOperation();
      } else {
        clearGoogleOAuthAttempt({ clearPersistedVerifier: callbackResult.kind !== "code" });
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
        setCallbackFailed(callbackResult.message, callbackResult.method);
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_completed",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(callbackResult.message),
        });
        return true;
      }

      if (callbackResult.kind === "code") {
        return exchangeAuthCode(callbackResult.code, callbackResult.method);
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
      setCallbackReceived(callbackResult.method);
      setCallbackExchanging("Applying OAuth session.", callbackResult.method);

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
        setCallbackFailed(
          error ? getOAuthSessionCallbackErrorMessage(error.message) : "OAuth session callback did not return a session.",
          callbackResult.method,
        );
        applySession(previousSession);
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_completed",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(error ?? new Error("OAuth session callback did not return a session")),
        });
        return true;
      }

      recordAuthDiagnostic("auth.callback.session.success", {
        callbackKind: "session",
        source,
        ...getSessionDiagnosticSummary(callbackSession),
      });
      applySession(callbackSession);
      await saveDesktopSession(callbackSession);
      setCallbackCompleted(callbackResult.method);
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_completed",
        method: "oauth",
        result: "success",
      });
      return true;
    };

    const handleAuthCallbackUrls = async (urls: string[]) => {
      for (const url of urls) {
        if (dispatchTeamInviteDeepLink(url)) {
          continue;
        }
        const billingSuccess = readBillingSuccessDeepLink(url);
        if (billingSuccess) {
          if (billingSuccess.source === "promo") storePendingPromoHandoff();
          window.dispatchEvent(new CustomEvent("drifty:billing-success", { detail: billingSuccess }));
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
          cleanupTauriEventListener(nextUnlistenDeepLink);
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
      await saveDesktopSession(session, {
        allowClear: !preserveNativeSessionAfterRestoreFailure,
        skipReason: "native-restore-failed",
      });
      recordAuthDiagnostic("auth.init.complete", {
        source: "supabase-storage",
        ...getSessionDiagnosticSummary(session),
      });
    };

    void initializeAuth()
      .catch((error) => {
        recordAuthDiagnostic("auth.init.error", getAuthDiagnosticError(error));
        console.warn("Unable to initialize auth.", error);
        if (isActive) {
          clearSession("offline");
        }
      })
      .finally(() => {
        isInitializingAuth = false;
        clearInitializationTimeout();
      });

    const { data: { subscription } } = client.auth.onAuthStateChange(
      (event, session) => {
        recordAuthDiagnostic("auth.state_change", {
          eventType: event,
          ...getSessionDiagnosticSummary(session),
        });
        if (event === "INITIAL_SESSION" && !session && isInitializingAuth) {
          recordAuthDiagnostic("auth.state_change.skipped", {
            eventType: event,
            reason: "initial-null-session-during-auth-init",
          });
          void saveDesktopSession(null, {
            allowClear: false,
            skipReason: "initial-null-session-during-auth-init",
          });
          return;
        }
        applySession(session);
        void saveDesktopSession(session);
      }
    );

    return () => {
      isActive = false;
      clearGoogleOAuthAttempt({ clearPersistedVerifier: false });
      cleanupTauriEventListener(unlistenDeepLink);
      if (pendingDeepLinkInterval !== null) {
        window.clearInterval(pendingDeepLinkInterval);
      }
      clearInitializationTimeout();
      subscription.unsubscribe();
    };
  }, []);

  async function signInWithEmail(email: string, password: string) {
    if (!supabase) {
      const error = new Error("Supabase is not configured");
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_completed",
        method: "email",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return { error };
    }
    clearGoogleOAuthAttempt();
    setCallbackStatus(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    capturePostHogEvent("cloud_auth_action", {
      action: "sign_in_completed",
      method: "email",
      result: error ? "error" : "success",
      ...(error ? { error_kind: toAnalyticsErrorKind(error) } : {}),
    });
    return { error };
  }

  async function signInAnonymously() {
    if (!authModePolicy.allowsAnonymousAuth) {
      const error = new Error("Sign in is required before joining the leaderboard.");
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_completed",
        method: "anonymous",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return { error, user: null };
    }

    if (!supabase) {
      const error = new Error("Supabase is not configured");
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_completed",
        method: "anonymous",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return { error, user: null };
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_completed",
        method: "anonymous",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return { error, user: null };
    }

    const nextSession = data.session ?? (await supabase.auth.getSession()).data.session;
    if (nextSession) {
      recordAuthDiagnostic("auth.anonymous_sign_in.success", getSessionDiagnosticSummary(nextSession));
      applySessionState(nextSession);
      await saveDesktopSession(nextSession);
    }

    capturePostHogEvent("cloud_auth_action", {
      action: "sign_in_completed",
      method: "anonymous",
      result: "success",
    });
    return { error: null, user: nextSession?.user ?? data.user ?? null };
  }

  async function signUpWithEmail(email: string, password: string) {
    if (!supabase) {
      const error = new Error("Supabase is not configured");
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_up_completed",
        method: "email",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return { error, needsEmailConfirmation: false };
    }
    clearGoogleOAuthAttempt();
    setCallbackStatus(null);
    const validationError = validateAuthPasswordForSignUp(password);
    if (validationError) {
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_up_completed",
        method: "email",
        result: "error",
        error_kind: toAnalyticsErrorKind(validationError),
      });
      return { error: validationError, needsEmailConfirmation: false };
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: DESKTOP_EMAIL_AUTH_BRIDGE_URL,
      },
    });
    const normalizedError = normalizeAuthPasswordError(error);
    const needsEmailConfirmation = !data.session && !normalizedError;
    capturePostHogEvent("cloud_auth_action", {
      action: "sign_up_completed",
      method: "email",
      result: normalizedError ? "error" : "success",
      ...(normalizedError ? { error_kind: toAnalyticsErrorKind(normalizedError) } : {}),
    });
    return { error: normalizedError, needsEmailConfirmation };
  }

  function clearCallbackStatus() {
    clearGoogleOAuthAttempt();
    setCallbackStatus(null);
  }

  async function signInWithWebsite() {
    if (!supabase) {
      const error = new Error("Supabase is not configured");
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_started",
        method: "website",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return { error };
    }
    const isDesktop = isTauriRuntime();
    clearGoogleOAuthAttempt();

    setCallbackStatus({
      phase: "waiting",
      message: isDesktop
        ? "Opening drifty.so in your browser. Sign in there, then choose Open Drifty."
        : "Opening drifty.so sign-in.",
      method: "website",
    });

    if (isDesktop) {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(DESKTOP_LOGIN_URL);
        setCallbackStatus({
          phase: "waiting",
          message: "Browser opened.",
          method: "website",
        });
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "website",
          result: "success",
        });
      } catch (error) {
        const openError = error instanceof Error
          ? error
          : new Error("Unable to open drifty.so sign-in");
        setCallbackStatus({
          phase: "failed",
          message: openError.message,
          method: "website",
        });
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "website",
          result: "error",
          error_kind: toAnalyticsErrorKind(openError),
        });
        return { error: openError };
      }

      return { error: null };
    }

    window.location.assign(DESKTOP_LOGIN_URL);
    capturePostHogEvent("cloud_auth_action", {
      action: "sign_in_started",
      method: "website",
      result: "success",
    });
    return { error: null };
  }

  async function signInWithGoogleAndCalendar() {
    if (!supabase) {
      return { error: new Error("Supabase is not configured") };
    }
    if (googleCalendarOAuthInFlightRef.current) {
      return { error: null };
    }

    googleCalendarOAuthInFlightRef.current = true;
    clearGoogleOAuthAttempt();
    setCallbackStatus({
      phase: "waiting",
      message: "Opening Google sign-in and optional Calendar access...",
      method: "google",
      googleAction: "opening",
    });

    let attemptId: string | null = null;
    try {
      const capability = await getGoogleCalendarCapability();
      if (!capability.configured) {
        setCallbackStatus({
          phase: "waiting",
          message: GOOGLE_CALENDAR_FALLBACK_MESSAGE,
          method: "google",
          googleAction: "opening",
        });
        return await signInWithGoogleLegacy();
      }

      const authorization = await authorizeGoogleCalendar("signIn");
      attemptId = authorization.attemptId;
      if (!authorization.idToken || !authorization.accessToken) {
        await discardPendingGoogleCalendarConnection(authorization.attemptId);
        attemptId = null;
        throw new Error("Google identity tokens were missing from the authorization result.");
      }

      setCallbackStatus({
        phase: "exchanging",
        message: "Completing Google sign-in...",
        method: "google",
      });
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: authorization.idToken,
        access_token: authorization.accessToken,
      });
      if (error || !data.session) {
        throw error ?? new Error("Google sign-in did not return a session.");
      }

      const googleIdentitySubject = data.user?.identities
        ?.find((identity) => identity.provider === "google")
        ?.identity_data?.sub;
      if (
        authorization.googleSubject
        && typeof googleIdentitySubject === "string"
        && googleIdentitySubject !== authorization.googleSubject
      ) {
        await discardPendingGoogleCalendarConnection(authorization.attemptId);
        attemptId = null;
        try {
          const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
          if (signOutError) {
            recordAuthDiagnostic("auth.google_calendar.identity_cleanup.error", getAuthDiagnosticError(signOutError));
          }
        } catch (signOutError) {
          recordAuthDiagnostic("auth.google_calendar.identity_cleanup.error", getAuthDiagnosticError(signOutError));
        }
        applySessionState(null);
        await saveDesktopSession(null);
        throw new GoogleCalendarIdentityMismatchError();
      }

      applySessionState(data.session);
      await saveDesktopSession(data.session);

      let calendarConnected = false;
      try {
        const calendarStatus = await finalizeGoogleCalendarConnection(
          data.session.user.id,
          authorization.attemptId,
          "signIn",
        );
        attemptId = null;
        calendarConnected = calendarStatus.connected;
        notifyGoogleCalendarConnectionChanged();
      } catch (calendarError) {
        recordAuthDiagnostic("auth.google_calendar.finalize.error", getAuthDiagnosticError(calendarError));
        if (attemptId) {
          try {
            await discardPendingGoogleCalendarConnection(attemptId);
          } catch {
          }
          attemptId = null;
        }
      }

      setCallbackStatus({
        phase: "completed",
        message: calendarConnected ? GOOGLE_CALENDAR_CONNECTED_MESSAGE : GOOGLE_CALENDAR_SKIPPED_MESSAGE,
        method: "google",
      });
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_completed",
        method: "oauth",
        result: "success",
      });
      return { error: null };
    } catch (error) {
      if (attemptId) {
        try {
          await discardPendingGoogleCalendarConnection(attemptId);
        } catch {
        }
      }
      if (isGoogleCalendarAuthorizationCancelled(error)) {
        const cancelledError = new Error(GOOGLE_CALENDAR_CANCELLED_MESSAGE);
        setCallbackStatus({
          phase: "failed",
          message: cancelledError.message,
          method: "google",
          googleAction: "retry",
        });
        return { error: cancelledError };
      }

      if (error instanceof GoogleCalendarIdentityMismatchError) {
        setCallbackStatus({
          phase: "failed",
          message: error.message,
          method: "google",
          googleAction: "retry",
        });
        recordAuthDiagnostic("auth.google_calendar.identity_mismatch", getAuthDiagnosticError(error));
        return { error };
      }

      recordAuthDiagnostic("auth.google_calendar.authorization.error", getAuthDiagnosticError(error));
      setCallbackStatus({
        phase: "waiting",
        message: GOOGLE_CALENDAR_FALLBACK_MESSAGE,
        method: "google",
        googleAction: "opening",
      });
      return await signInWithGoogleLegacy();
    } finally {
      googleCalendarOAuthInFlightRef.current = false;
    }
  }

  async function signInWithGoogle(options: GoogleSignInOptions = {}) {
    if (options.requestCalendar && isGoogleCalendarOnboardingEnabled()) {
      return signInWithGoogleAndCalendar();
    }
    return signInWithGoogleLegacy();
  }

  async function signInWithGoogleLegacy() {
    if (!supabase) {
      const error = new Error("Supabase is not configured");
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_started",
        method: "oauth",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return { error };
    }
    if (googleOAuthActiveOperationRef.current !== null) {
      recordAuthDiagnostic("auth.google_oauth.open.skipped", { reason: "open-in-progress" });
      return { error: null };
    }

    const isDesktop = isTauriRuntime();
    const operationId = googleOAuthOperationSequenceRef.current + 1;
    googleOAuthOperationSequenceRef.current = operationId;
    let cancelOperation: () => void = () => undefined;
    const operationCancellation = new Promise<void>((resolve) => {
      cancelOperation = resolve;
    });
    googleOAuthActiveOperationRef.current = { id: operationId, cancel: cancelOperation };
    const isCurrentOperation = () => googleOAuthActiveOperationRef.current?.id === operationId;
    const cancelledResult = () => {
      recordAuthDiagnostic("auth.google_oauth.operation.cancelled", { operationId });
      return { error: null };
    };

    const openDesktopAttempt = async (attempt: GoogleOAuthAttempt, reopening: boolean) => {
      if (!isCurrentOperation()) return cancelledResult();
      setCallbackStatus({
        phase: "waiting",
        message: reopening ? GOOGLE_BROWSER_REOPENING_MESSAGE : "Opening Google sign-in...",
        method: "google",
        googleAction: "opening",
      });

      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        if (!isCurrentOperation()) return cancelledResult();
        await withGoogleOAuthOperationTimeout(openUrl(attempt.url), operationCancellation);
        if (!isCurrentOperation()) return cancelledResult();
        if (googleOAuthAttemptRef.current?.id === attempt.id) {
          setCallbackStatus({
            phase: "waiting",
            message: GOOGLE_BROWSER_OPENED_MESSAGE,
            method: "google",
            googleAction: "reopen",
          });
        }
        recordAuthDiagnostic(reopening ? "auth.google_oauth.reopened" : "auth.google_oauth.opened", {
          attemptId: attempt.id,
        });
        if (!reopening) {
          capturePostHogEvent("cloud_auth_action", {
            action: "sign_in_started",
            method: "oauth",
            result: "success",
          });
        }
        return { error: null };
      } catch (error) {
        if (!isCurrentOperation()) return cancelledResult();
        const analyticsError = error instanceof Error ? error : String(error ?? "");
        const openError = new Error(GOOGLE_BROWSER_OPEN_FAILED_MESSAGE);
        recordAuthDiagnostic(
          reopening ? "auth.google_oauth.reopen.error" : "auth.google_oauth.open.error",
          getAuthDiagnosticError(error),
        );
        if (googleOAuthAttemptRef.current?.id === attempt.id) {
          setCallbackStatus({
            phase: "failed",
            message: openError.message,
            method: "google",
            googleAction: "reopen",
          });
        }
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(analyticsError),
        });
        return { error: openError };
      }
    };

    try {
      const activeAttempt = googleOAuthAttemptRef.current;
      const now = Date.now();
      if (
        isDesktop
        && activeAttempt
        && activeAttempt.expiresAt > now
        && hasUsableGoogleOAuthVerifier(now)
      ) {
        return await openDesktopAttempt(activeAttempt, true);
      }
      if (activeAttempt) {
        if (activeAttempt.expiresAt <= now) {
          expireGoogleOAuthAttempt(activeAttempt.id, { cancelPending: false });
        } else {
          recordAuthDiagnostic("auth.google_oauth.reopen.invalidated", {
            attemptId: activeAttempt.id,
            reason: "missing-or-invalid-verifier",
          });
          clearGoogleOAuthAttempt({ cancelPending: false });
        }
      }
      clearGoogleOAuthVerifier();

      if (!isCurrentOperation()) return cancelledResult();
      setCallbackStatus({
        phase: "waiting",
        message: "Opening Google sign-in...",
        method: "google",
        googleAction: "opening",
      });

      let oauthResponse;
      try {
        oauthResponse = await withGoogleOAuthOperationTimeout(prepareGoogleOAuthAuthorization({
            redirectTo: DESKTOP_GOOGLE_AUTH_BRIDGE_URL,
            skipBrowserRedirect: true,
            queryParams: {
              prompt: "select_account",
            },
        }), operationCancellation);
      } catch (error) {
        if (!isCurrentOperation()) return cancelledResult();
        const requestError = error instanceof GoogleOAuthOperationTimeoutError
          ? new Error(GOOGLE_OAUTH_REQUEST_TIMEOUT_MESSAGE)
          : new Error(GOOGLE_OAUTH_REQUEST_FAILED_MESSAGE);
        setCallbackStatus({
          phase: "failed",
          message: requestError.message,
          method: "google",
          googleAction: "retry",
        });
        recordAuthDiagnostic("auth.google_oauth.request.error", getAuthDiagnosticError(error));
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(error),
        });
        return { error: requestError };
      }

      if (!isCurrentOperation()) return cancelledResult();
      const { data, error } = oauthResponse;

      if (error) {
        const requestError = new Error(GOOGLE_OAUTH_REQUEST_FAILED_MESSAGE);
        setCallbackStatus({
          phase: "failed",
          message: requestError.message,
          method: "google",
          googleAction: "retry",
        });
        recordAuthDiagnostic("auth.google_oauth.request.error", getAuthDiagnosticError(error));
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(error),
        });
        return { error: requestError };
      }

      if (!data.url) {
        const missingUrlError = new Error("Google sign-in did not return an OAuth URL.");
        setCallbackStatus({
          phase: "failed",
          message: missingUrlError.message,
          method: "google",
          googleAction: "retry",
        });
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(missingUrlError),
        });
        return { error: missingUrlError };
      }

      if (!isValidGoogleOAuthUrl(data.url)) {
        const invalidUrlError = new Error("Google sign-in returned an invalid OAuth URL. Try again.");
        setCallbackStatus({
          phase: "failed",
          message: invalidUrlError.message,
          method: "google",
          googleAction: "retry",
        });
        recordAuthDiagnostic("auth.google_oauth.url.rejected", { reason: "untrusted-destination" });
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(invalidUrlError),
        });
        return { error: invalidUrlError };
      }

      try {
        const expiresAt = Date.now() + GOOGLE_OAUTH_HANDOFF_TIMEOUT_MS;
        oauthResponse.activateVerifier(expiresAt);
        if (!isCurrentOperation()) {
          clearGoogleOAuthVerifier();
          return cancelledResult();
        }

        if (isDesktop) {
          const attempt = rememberGoogleOAuthAttempt(data.url, expiresAt);
          return await openDesktopAttempt(attempt, false);
        }
      } catch (error) {
        if (!isCurrentOperation()) return cancelledResult();
        const storageError = new Error("Secure browser storage is unavailable for Google sign-in.");
        setCallbackStatus({
          phase: "failed",
          message: storageError.message,
          method: "google",
          googleAction: "retry",
        });
        recordAuthDiagnostic("auth.google_oauth.verifier.error", getAuthDiagnosticError(error));
        capturePostHogEvent("cloud_auth_action", {
          action: "sign_in_started",
          method: "oauth",
          result: "error",
          error_kind: toAnalyticsErrorKind(storageError),
        });
        return { error: storageError };
      }

      if (!isCurrentOperation()) {
        clearGoogleOAuthVerifier();
        return cancelledResult();
      }

      window.location.assign(data.url);
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_in_started",
        method: "oauth",
        result: "success",
      });
      return { error: null };
    } finally {
      if (googleOAuthActiveOperationRef.current?.id === operationId) {
        googleOAuthActiveOperationRef.current = null;
      }
    }
  }

  async function signOut() {
    if (!supabase) return;
    clearGoogleOAuthAttempt();
    setCallbackStatus(null);
    recordAuthDiagnostic("auth.sign_out.start", getSessionDiagnosticSummary(sessionRef.current));
    try {
      await supabase.auth.signOut();
      applySessionState(null);
      await saveDesktopSession(null);
      recordAuthDiagnostic("auth.sign_out.complete", { hasSession: false });
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_out",
        method: "unknown",
        result: "success",
      });
    } catch (error) {
      capturePostHogEvent("cloud_auth_action", {
        action: "sign_out",
        method: "unknown",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      throw error;
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        status,
        cloudConnectionStatus,
        callbackStatus,
        isEnabled: isSupabaseEnabled(),
        authMode: authModePolicy.mode,
        isAuthRequired: authModePolicy.isAuthRequired,
        allowsAnonymousAuth: authModePolicy.allowsAnonymousAuth,
        hasRequiredAccountAuth: hasRequiredAccountAuth(user),
        hasBlockingAuthConfigurationError: hasBlockingAuthConfigurationError(),
        signInWithWebsite,
        signInWithGoogle,
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
