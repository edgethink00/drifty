import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const driftyAuthModeValue = import.meta.env.VITE_DRIFTY_AUTH_MODE;
const legacyAuthModeValue = import.meta.env.VITE_DTIME_AUTH_MODE;

const DESKTOP_AUTH_STORAGE_KEY = "drifty.desktop.auth";
const LEGACY_DESKTOP_AUTH_STORAGE_KEY = "dtime.desktop.auth";

function migrateDesktopAuthStorage() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(DESKTOP_AUTH_STORAGE_KEY) !== null) return;
    const legacyValue = window.localStorage.getItem(LEGACY_DESKTOP_AUTH_STORAGE_KEY);
    if (legacyValue !== null) {
      window.localStorage.setItem(DESKTOP_AUTH_STORAGE_KEY, legacyValue);
    }
  } catch {
    // Supabase will continue with its configured storage key if localStorage is unavailable.
  }
}

migrateDesktopAuthStorage();

export type DtimeAuthMode = "optional" | "required";

function resolveAuthMode(value: string | undefined, envName: "VITE_DRIFTY_AUTH_MODE" | "VITE_DTIME_AUTH_MODE"): DtimeAuthMode {
  const normalizedValue = value?.trim();
  if (normalizedValue === "required") return "required";
  if (normalizedValue === "optional" || normalizedValue === undefined || normalizedValue === "") return "optional";

  console.warn(`[Auth] Unsupported ${envName}=${value}. Falling back to optional auth mode.`);
  return "optional";
}

const preferredAuthModeValue = driftyAuthModeValue?.trim() ? driftyAuthModeValue : legacyAuthModeValue;
const preferredAuthModeEnvName = driftyAuthModeValue?.trim() ? "VITE_DRIFTY_AUTH_MODE" : "VITE_DTIME_AUTH_MODE";
const authMode = resolveAuthMode(preferredAuthModeValue, preferredAuthModeEnvName);

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
          flowType: "implicit",
          storageKey: DESKTOP_AUTH_STORAGE_KEY,
        },
      })
    : null;

export function isSupabaseEnabled() {
  return supabase !== null;
}

export function hasBlockingAuthConfigurationError() {
  return authModePolicy.isAuthRequired && !isSupabaseEnabled();
}
