import type { User } from "@supabase/supabase-js";

/**
 * A saved sign-in that Drifty could not confirm with the server because the
 * server was unreachable. Local features keep the saved account; cloud
 * features wait until the session is confirmed. A server rejection is never
 * classified here: it signs the person out as before.
 */

type AccessTokenClaims = Record<string, unknown>;

export type StoredAuthSessionSnapshot = {
  readonly user: User | null;
  readonly accessTokenSubject: string | null;
  readonly expiresAt: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeBase64UrlSegment(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Reads JWT claims locally. The result identifies the saved account only; it is never treated as verified. */
export function readAccessTokenClaims(accessToken: string): AccessTokenClaims | null {
  const segments = accessToken.split(".");
  if (segments.length !== 3 || !segments[1]) return null;
  const json = decodeBase64UrlSegment(segments[1]);
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function claimSubject(claims: AccessTokenClaims | null): string | null {
  return typeof claims?.sub === "string" && claims.sub.length > 0 ? claims.sub : null;
}

function isStoredUser(value: unknown): value is User {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

export function parseStoredAuthSession(rawValue: string | null): StoredAuthSessionSnapshot | null {
  if (!rawValue) return null;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.access_token !== "string" || typeof parsed.refresh_token !== "string") return null;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    const accessTokenSubject = claimSubject(readAccessTokenClaims(parsed.access_token));
    const user = isStoredUser(parsed.user) && (!accessTokenSubject || parsed.user.id === accessTokenSubject)
      ? parsed.user
      : null;
    return {
      user,
      accessTokenSubject,
      expiresAt: typeof parsed.expires_at === "number" && Number.isFinite(parsed.expires_at) ? parsed.expires_at : null,
    };
  } catch {
    return null;
  }
}

export function isStoredAuthSessionExpired(snapshot: StoredAuthSessionSnapshot | null, nowMs = Date.now()): boolean {
  if (!snapshot || snapshot.expiresAt === null) return true;
  return snapshot.expiresAt * 1000 <= nowMs;
}

function userFromAccessTokenClaims(claims: AccessTokenClaims): User | null {
  const subject = claimSubject(claims);
  if (!subject) return null;
  return {
    id: subject,
    aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
    role: typeof claims.role === "string" ? claims.role : undefined,
    email: typeof claims.email === "string" && claims.email ? claims.email : undefined,
    phone: typeof claims.phone === "string" && claims.phone ? claims.phone : undefined,
    app_metadata: isRecord(claims.app_metadata) ? claims.app_metadata : {},
    user_metadata: isRecord(claims.user_metadata) ? claims.user_metadata : {},
    is_anonymous: claims.is_anonymous === true,
    created_at: "",
  };
}

/**
 * The account a saved sign-in belongs to. The OS credential store is the
 * desktop source of truth; the WebView copy supplies the full profile when it
 * belongs to the same account.
 */
export function resolveSavedSignInUser({
  nativeAccessToken,
  storedSession,
}: {
  readonly nativeAccessToken?: string | null;
  readonly storedSession: StoredAuthSessionSnapshot | null;
}): User | null {
  if (nativeAccessToken) {
    const nativeClaims = readAccessTokenClaims(nativeAccessToken);
    const nativeSubject = claimSubject(nativeClaims);
    if (nativeClaims && nativeSubject) {
      if (storedSession?.user?.id === nativeSubject) return storedSession.user;
      return userFromAccessTokenClaims(nativeClaims);
    }
  }
  return storedSession?.user ?? null;
}

/**
 * True only when the auth server could not be reached or did not answer as
 * the auth server: no connection, a timeout, a 5xx, or a non-JSON response
 * from a proxy or captive portal. A 4xx answer is a rejection.
 */
export function isAuthServerUnreachableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, status } = error as { name?: unknown; status?: unknown };
  if (name === "AuthRetryableFetchError" || name === "AuthUnknownError") return true;
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (typeof status === "number" && (status === 0 || status >= 500)) return true;
  return error instanceof TypeError;
}
