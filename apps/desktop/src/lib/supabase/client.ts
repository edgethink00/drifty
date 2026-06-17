import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const driftyAuthModeValue = import.meta.env.VITE_DRIFTY_AUTH_MODE;

const DESKTOP_AUTH_STORAGE_KEY = "drifty.desktop.auth";

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
