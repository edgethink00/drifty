import type { Session } from "@supabase/supabase-js";

const PASSWORD_RECOVERY_STORAGE_KEY = "drifty.desktop.password-recovery";
export const PASSWORD_RECOVERY_TTL_MS = 30 * 60 * 1000;

export interface PendingPasswordRecovery {
  readonly version: 1;
  readonly phase: "requested" | "verified";
  readonly email: string;
  readonly expiresAt: number;
  readonly userId?: string;
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

export function createPendingPasswordRecovery(
  email: string,
  now = Date.now(),
): PendingPasswordRecovery {
  return {
    version: 1,
    phase: "requested",
    email: normalizeEmail(email),
    expiresAt: now + PASSWORD_RECOVERY_TTL_MS,
  };
}

export function writePendingPasswordRecovery(
  recovery: PendingPasswordRecovery,
  storage: Storage | null = typeof globalThis.localStorage === "object" ? globalThis.localStorage : null,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PASSWORD_RECOVERY_STORAGE_KEY, JSON.stringify(recovery));
    return true;
  } catch {
    return false;
  }
}

export function readPendingPasswordRecovery(
  now = Date.now(),
  storage: Storage | null = typeof globalThis.localStorage === "object" ? globalThis.localStorage : null,
): PendingPasswordRecovery | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PASSWORD_RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPasswordRecovery>;
    if (
      parsed.version !== 1
      || (parsed.phase !== "requested" && parsed.phase !== "verified")
      || typeof parsed.email !== "string"
      || normalizeEmail(parsed.email) !== parsed.email
      || parsed.email.length === 0
      || typeof parsed.expiresAt !== "number"
      || !Number.isFinite(parsed.expiresAt)
      || (parsed.phase === "requested" && parsed.expiresAt <= now)
      || (parsed.phase === "verified" && (typeof parsed.userId !== "string" || parsed.userId.length === 0))
    ) {
      storage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
      return null;
    }
    return parsed as PendingPasswordRecovery;
  } catch {
    try {
      storage.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
    } catch {
    }
    return null;
  }
}

export function hasPendingPasswordRecoveryMarker(
  storage: Storage | null = typeof globalThis.localStorage === "object" ? globalThis.localStorage : null,
): boolean {
  try {
    return storage?.getItem(PASSWORD_RECOVERY_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearPendingPasswordRecovery(
  storage: Storage | null = typeof globalThis.localStorage === "object" ? globalThis.localStorage : null,
): void {
  try {
    storage?.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
  } catch {
  }
}

export function doesRecoverySessionMatchRequest(
  recovery: PendingPasswordRecovery,
  session: Session,
): boolean {
  return normalizeEmail(session.user.email) === recovery.email
    && (recovery.phase !== "verified" || recovery.userId === session.user.id);
}

export function markPasswordRecoveryVerified(
  recovery: PendingPasswordRecovery,
  session: Session,
): PendingPasswordRecovery {
  return {
    ...recovery,
    phase: "verified",
    userId: session.user.id,
  };
}
