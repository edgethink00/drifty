import type { Session } from "@supabase/supabase-js";

export const AUTH_DIAGNOSTICS_STORAGE_KEY = "drifty.auth.diagnostics.v1";
export const AUTH_DIAGNOSTICS_LIMIT = 150;

type DiagnosticValue = string | number | boolean | null;

export interface AuthDiagnosticEntry {
  at: string;
  sequence: number;
  event: string;
  payload: Record<string, DiagnosticValue>;
}

type AuthDiagnosticOptions = {
  storage?: Storage;
  now?: () => Date;
  mirrorToConsole?: boolean;
};

const ALLOWED_PAYLOAD_KEYS = new Set([
  "accessTokenFingerprint",
  "allowsAnonymousAuth",
  "authMode",
  "callbackKind",
  "errorMessage",
  "errorName",
  "eventType",
  "expiresAt",
  "expiresInSeconds",
  "hasAccessToken",
  "hasRefreshToken",
  "hasSavedSession",
  "hasSession",
  "hasUser",
  "isAnonymous",
  "isAuthRequired",
  "operation",
  "outcome",
  "pendingUrlCount",
  "reason",
  "refreshTokenFingerprint",
  "runtime",
  "saveId",
  "source",
  "storageAvailable",
]);

function getDefaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStorage(options?: AuthDiagnosticOptions): Storage | null {
  if (options && "storage" in options) return options.storage ?? null;
  return getDefaultStorage();
}

function sanitizeEventName(event: string): string {
  return event.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "auth.unknown";
}

function sanitizeText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/([?&#](?:access_token|refresh_token|token|code)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\b(?:access_token|refresh_token|token|code)[:=][^\s,;}]+/gi, (match) => `${match.split(/[:=]/)[0]}=[redacted]`)
    .slice(0, 180);
}

function sanitizePayloadValue(value: unknown): DiagnosticValue | undefined {
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  return undefined;
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, DiagnosticValue> {
  const safePayload: Record<string, DiagnosticValue> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) continue;
    const safeValue = sanitizePayloadValue(value);
    if (safeValue !== undefined) safePayload[key] = safeValue;
  }
  return safePayload;
}

function parseEntries(value: string | null): AuthDiagnosticEntry[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is AuthDiagnosticEntry => {
      if (!entry || typeof entry !== "object") return false;
      const record = entry as Record<string, unknown>;
      return typeof record.at === "string"
        && typeof record.sequence === "number"
        && typeof record.event === "string"
        && Boolean(record.payload)
        && typeof record.payload === "object";
    });
  } catch {
    return [];
  }
}

function shouldMirrorToConsole(options?: AuthDiagnosticOptions): boolean {
  if (typeof options?.mirrorToConsole === "boolean") return options.mirrorToConsole;
  return typeof import.meta !== "undefined" && import.meta.env.DEV && import.meta.env.MODE !== "test";
}

export function readAuthDiagnostics(options?: AuthDiagnosticOptions): AuthDiagnosticEntry[] {
  const storage = getStorage(options);
  if (!storage) return [];
  try {
    return parseEntries(storage.getItem(AUTH_DIAGNOSTICS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function clearAuthDiagnostics(options?: AuthDiagnosticOptions): void {
  const storage = getStorage(options);
  if (!storage) return;
  try {
    storage.removeItem(AUTH_DIAGNOSTICS_STORAGE_KEY);
  } catch {
  }
}

export function recordAuthDiagnostic(event: string, payload: Record<string, unknown> = {}, options?: AuthDiagnosticOptions): void {
  const storage = getStorage(options);
  const entries = readAuthDiagnostics(options);
  const sequence = (entries[entries.length - 1]?.sequence ?? 0) + 1;
  const entry: AuthDiagnosticEntry = {
    at: (options?.now?.() ?? new Date()).toISOString(),
    sequence,
    event: sanitizeEventName(event),
    payload: sanitizePayload(payload),
  };

  if (storage) {
    try {
      storage.setItem(AUTH_DIAGNOSTICS_STORAGE_KEY, JSON.stringify([...entries, entry].slice(-AUTH_DIAGNOSTICS_LIMIT)));
    } catch {
    }
  }

  if (shouldMirrorToConsole(options)) {
    console.debug("[auth-diagnostics]", entry.event, entry.payload);
  }
}

function tokenFingerprint(value: string | undefined): string | null {
  if (!value) return null;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 8);
}

export function getSessionDiagnosticSummary(session: Session | null): Record<string, DiagnosticValue> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = typeof session?.expires_at === "number" ? session.expires_at : null;
  return {
    hasSession: Boolean(session),
    hasUser: Boolean(session?.user),
    isAnonymous: session?.user?.is_anonymous === true,
    hasAccessToken: Boolean(session?.access_token),
    hasRefreshToken: Boolean(session?.refresh_token),
    accessTokenFingerprint: tokenFingerprint(session?.access_token),
    refreshTokenFingerprint: tokenFingerprint(session?.refresh_token),
    expiresAt,
    expiresInSeconds: expiresAt === null ? null : expiresAt - nowSeconds,
  };
}

export function getDesktopSessionDiagnosticSummary(session: { accessToken: string; refreshToken: string } | null): Record<string, DiagnosticValue> {
  return {
    hasSavedSession: Boolean(session),
    hasAccessToken: Boolean(session?.accessToken),
    hasRefreshToken: Boolean(session?.refreshToken),
    accessTokenFingerprint: tokenFingerprint(session?.accessToken),
    refreshTokenFingerprint: tokenFingerprint(session?.refreshToken),
  };
}

export function getAuthDiagnosticError(error: unknown): Record<string, DiagnosticValue> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: sanitizeText(error.message),
    };
  }

  return {
    errorName: "UnknownError",
    errorMessage: sanitizeText(String(error)),
  };
}
