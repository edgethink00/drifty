import { createClient, type Session } from "@supabase/supabase-js";
import { DESKTOP_AUTH_STORAGE_KEY } from "./authStorageKey";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const driftyAuthModeValue = import.meta.env.VITE_DRIFTY_AUTH_MODE;

const GOOGLE_OAUTH_VERIFIER_STORAGE_KEY = `${DESKTOP_AUTH_STORAGE_KEY}-code-verifier`;
const GOOGLE_OAUTH_ATTEMPT_STORAGE_KEY = `${DESKTOP_AUTH_STORAGE_KEY}-google-oauth-attempt`;
const GOOGLE_OAUTH_AUTHORIZE_PATH = "/auth/v1/authorize";
const PKCE_VERIFIER_BYTE_LENGTH = 64;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export interface PreparedGoogleOAuthAuthorization {
  data: { url: string | null };
  error: Error | null;
  activateVerifier: (expiresAt: number) => void;
}

interface StoredGoogleOAuthAttempt {
  version: 1;
  expiresAt: number;
}

interface StoredGoogleOAuthVerifier {
  encodedVerifier: string;
  verifier: string;
}

export interface GoogleOAuthCodeExchangeResult {
  data: { session: Session | null };
  error: Error | null;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createPkceVerifier(): string {
  const bytes = new Uint8Array(PKCE_VERIFIER_BYTE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function browserStorage(): Storage | null {
  return typeof globalThis.localStorage === "object" ? globalThis.localStorage : null;
}

export function clearGoogleOAuthVerifier(): boolean {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.removeItem(GOOGLE_OAUTH_VERIFIER_STORAGE_KEY);
    storage.removeItem(GOOGLE_OAUTH_ATTEMPT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function hasUsableGoogleOAuthVerifier(now = Date.now()): boolean {
  return readUsableGoogleOAuthVerifier(now) !== null;
}

function readUsableGoogleOAuthVerifier(now = Date.now()): StoredGoogleOAuthVerifier | null {
  try {
    const storage = browserStorage();
    if (!storage) return null;
    const encodedVerifier = storage.getItem(GOOGLE_OAUTH_VERIFIER_STORAGE_KEY);
    const encodedAttempt = storage.getItem(GOOGLE_OAUTH_ATTEMPT_STORAGE_KEY);
    if (!encodedVerifier || !encodedAttempt) {
      clearGoogleOAuthVerifier();
      return null;
    }

    const verifier = JSON.parse(encodedVerifier) as unknown;
    const attempt = JSON.parse(encodedAttempt) as Partial<StoredGoogleOAuthAttempt>;
    const isUsable = typeof verifier === "string"
      && PKCE_VERIFIER_PATTERN.test(verifier)
      && attempt.version === 1
      && typeof attempt.expiresAt === "number"
      && Number.isFinite(attempt.expiresAt)
      && attempt.expiresAt > now;
    if (!isUsable) {
      clearGoogleOAuthVerifier();
      return null;
    }
    return { encodedVerifier, verifier };
  } catch {
    clearGoogleOAuthVerifier();
    return null;
  }
}

function clearGoogleOAuthVerifierIfMatches(encodedVerifier: string): void {
  try {
    const storage = browserStorage();
    if (!storage || storage.getItem(GOOGLE_OAUTH_VERIFIER_STORAGE_KEY) !== encodedVerifier) {
      return;
    }
    storage.removeItem(GOOGLE_OAUTH_VERIFIER_STORAGE_KEY);
    storage.removeItem(GOOGLE_OAUTH_ATTEMPT_STORAGE_KEY);
  } catch {
  }
}

function abortErrorFromSignal(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Google OAuth code exchange was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortErrorFromSignal(signal);
}

function parseGoogleOAuthSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.access_token !== "string"
    || payload.access_token.length === 0
    || typeof payload.refresh_token !== "string"
    || payload.refresh_token.length === 0
    || typeof payload.token_type !== "string"
    || typeof payload.expires_in !== "number"
    || !Number.isFinite(payload.expires_in)
    || payload.expires_in <= 0
    || !payload.user
    || typeof payload.user !== "object"
    || typeof (payload.user as Record<string, unknown>).id !== "string"
  ) {
    return null;
  }

  const expiresAt = typeof payload.expires_at === "number" && Number.isFinite(payload.expires_at)
    ? payload.expires_at
    : Math.floor(Date.now() / 1000) + payload.expires_in;
  return {
    ...payload,
    expires_at: expiresAt,
  } as Session;
}

export async function exchangeGoogleOAuthCodeForSession(
  authCode: string,
  signal: AbortSignal,
): Promise<GoogleOAuthCodeExchangeResult> {
  if (
    !supabaseUrl
    || !supabaseAnonKey
    || typeof authCode !== "string"
    || authCode.length === 0
    || authCode.length > 4_096
  ) {
    return {
      data: { session: null },
      error: new Error("Google sign-in could not be completed. Try again."),
    };
  }

  const storedVerifier = readUsableGoogleOAuthVerifier();
  const storage = browserStorage();
  if (!storedVerifier || !storage) {
    return {
      data: { session: null },
      error: new Error("That Google sign-in attempt expired or was cancelled. Start Google sign-in again."),
    };
  }

  let shouldClearVerifier = false;
  try {
    throwIfAborted(signal);
    const tokenUrl = new URL("/auth/v1/token", supabaseUrl);
    tokenUrl.searchParams.set("grant_type", "pkce");
    const response = await globalThis.fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_code: authCode,
        code_verifier: storedVerifier.verifier,
      }),
      signal,
    });
    throwIfAborted(signal);

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      return {
        data: { session: null },
        error: new Error("Google sign-in could not be completed. Try again."),
      };
    }
    throwIfAborted(signal);

    if (!response.ok) {
      return {
        data: { session: null },
        error: new Error("Google sign-in could not be completed. Try again."),
      };
    }

    const session = parseGoogleOAuthSession(payload);
    if (!session) {
      return {
        data: { session: null },
        error: new Error("Google sign-in could not be completed. Try again."),
      };
    }

    throwIfAborted(signal);
    storage.setItem(DESKTOP_AUTH_STORAGE_KEY, JSON.stringify(session));
    shouldClearVerifier = true;
    return { data: { session }, error: null };
  } catch (error) {
    if (signal.aborted) throw abortErrorFromSignal(signal);
    return {
      data: { session: null },
      error: new Error("Google sign-in could not be completed. Try again."),
    };
  } finally {
    if (shouldClearVerifier) {
      clearGoogleOAuthVerifierIfMatches(storedVerifier.encodedVerifier);
    }
  }
}

async function createPkceChallenge(verifier: string): Promise<string> {
  if (!globalThis.crypto?.subtle || typeof globalThis.TextEncoder !== "function" || typeof globalThis.btoa !== "function") {
    throw new Error("Secure browser cryptography is unavailable for Google sign-in.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export function getGoogleOAuthAuthorizeUrl(): string | null {
  if (!supabaseUrl) return null;

  try {
    return new URL(GOOGLE_OAUTH_AUTHORIZE_PATH, supabaseUrl).toString();
  } catch {
    return null;
  }
}

export async function prepareGoogleOAuthAuthorization(options: {
  redirectTo: string;
  skipBrowserRedirect: true;
  queryParams: Record<string, string>;
}): Promise<PreparedGoogleOAuthAuthorization> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      data: { url: null },
      error: new Error("Supabase is not configured"),
      activateVerifier: () => undefined,
    };
  }

  const authorizeUrl = getGoogleOAuthAuthorizeUrl();
  if (!authorizeUrl) {
    return {
      data: { url: null },
      error: new Error("Supabase Google sign-in URL is invalid."),
      activateVerifier: () => undefined,
    };
  }

  let verifier: string;
  let challenge: string;
  try {
    verifier = createPkceVerifier();
    challenge = await createPkceChallenge(verifier);
  } catch (error) {
    return {
      data: { url: null },
      error: error instanceof Error
        ? error
        : new Error("Secure browser cryptography is unavailable for Google sign-in."),
      activateVerifier: () => undefined,
    };
  }

  const url = new URL(authorizeUrl);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", options.redirectTo);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "s256");
  for (const [key, value] of Object.entries(options.queryParams)) {
    if (!["provider", "redirect_to", "code_challenge", "code_challenge_method"].includes(key)) {
      url.searchParams.set(key, value);
    }
  }

  let activated = false;
  return {
    data: { url: url.toString() },
    error: null,
    activateVerifier: (expiresAt: number) => {
      if (activated) return;
      const storage = browserStorage();
      if (!storage || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error("Secure browser storage is unavailable for Google sign-in.");
      }
      const encodedVerifier = JSON.stringify(verifier);
      try {
        storage.setItem(GOOGLE_OAUTH_VERIFIER_STORAGE_KEY, encodedVerifier);
        storage.setItem(GOOGLE_OAUTH_ATTEMPT_STORAGE_KEY, JSON.stringify({
          version: 1,
          expiresAt,
        } satisfies StoredGoogleOAuthAttempt));
      } catch (error) {
        if (storage.getItem(GOOGLE_OAUTH_VERIFIER_STORAGE_KEY) === encodedVerifier) {
          storage.removeItem(GOOGLE_OAUTH_VERIFIER_STORAGE_KEY);
        }
        storage.removeItem(GOOGLE_OAUTH_ATTEMPT_STORAGE_KEY);
        throw error;
      }
      activated = true;
    },
  };
}

type SupabaseAuthLock = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;

const desktopAuthLockQueues = new Map<string, Promise<unknown>>();

export const desktopAuthLock: SupabaseAuthLock = async (name, acquireTimeout, fn) => {
  void acquireTimeout;

  const previousLock = desktopAuthLockQueues.get(name) ?? Promise.resolve();
  let releaseCurrentLock: () => void = () => undefined;
  const currentLock = new Promise<void>((resolve) => {
    releaseCurrentLock = resolve;
  });
  const queuedLock = previousLock.then(() => currentLock, () => currentLock);

  desktopAuthLockQueues.set(name, queuedLock);
  await previousLock.then(() => undefined, () => undefined);

  try {
    return await fn();
  } finally {
    releaseCurrentLock();
    if (desktopAuthLockQueues.get(name) === queuedLock) {
      desktopAuthLockQueues.delete(name);
    }
  }
};

export type DriftyAuthMode = "optional" | "required";

function resolveAuthMode(value: string | undefined): DriftyAuthMode {
  const normalizedValue = value?.trim();
  if (normalizedValue === "required") return "required";
  if (normalizedValue === "optional" || normalizedValue === undefined || normalizedValue === "") return "optional";

  console.warn(`[Auth] Unsupported VITE_DRIFTY_AUTH_MODE=${value}. Falling back to optional auth mode.`);
  return "optional";
}

const authMode = resolveAuthMode(driftyAuthModeValue);

export const authModePolicy = {
  mode: authMode,
  isAuthRequired: authMode === "required",
  allowsAnonymousAuth: authMode === "optional",
} as const;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    authModePolicy.isAuthRequired
      ? "[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. Required auth mode cannot start without Supabase configuration."
      : "[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. Cloud features will be disabled."
  );
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: "pkce",
          storageKey: DESKTOP_AUTH_STORAGE_KEY,
          lock: desktopAuthLock,
        },
      })
    : null;

export function isSupabaseEnabled() {
  return supabase !== null;
}

export function hasBlockingAuthConfigurationError() {
  return authModePolicy.isAuthRequired && !isSupabaseEnabled();
}
