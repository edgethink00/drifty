/**
 * The member's own sharing status per team (owner decision 2026-11-08): when this
 * computer last sent their time, how much went up over the last week, and why the
 * latest pass sent nothing or failed. Kept on this computer only; the automatic
 * share writes it and Team settings reads it.
 */
import { useEffect, useState } from "react";

import type { TeamAutoShareIdleReason, TeamAutoShareResult } from "./teamAutoShare";

const STORAGE_PREFIX = "drifty.team.shareStatus.";
const CHANGED_EVENT = "drifty:team-share-status-changed";

export type TeamShareStatus = {
  /** When the latest automatic pass for this team finished. */
  readonly checkedAt: string;
  readonly outcome: "shared" | "nothing" | "failed";
  readonly reason: TeamAutoShareIdleReason | null;
  readonly error: string | null;
  /** The last time anything went up; kept through later quiet or failed passes. */
  readonly sharedAt: string | null;
  readonly recentSeconds: number | null;
};

function storageKey(accountKey: string, organizationId: string): string {
  return STORAGE_PREFIX + accountKey + "." + organizationId;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readTeamShareStatus(accountKey: string | null, organizationId: string | null): TeamShareStatus | null {
  if (!accountKey || !organizationId) return null;
  try {
    const raw = storage()?.getItem(storageKey(accountKey, organizationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const outcome = parsed.outcome === "shared" || parsed.outcome === "nothing" || parsed.outcome === "failed" ? parsed.outcome : null;
    const checkedAt = text(parsed.checkedAt);
    if (!outcome || !checkedAt) return null;
    return {
      checkedAt,
      outcome,
      reason: (text(parsed.reason) as TeamAutoShareIdleReason | null) ?? null,
      error: text(parsed.error),
      sharedAt: text(parsed.sharedAt),
      recentSeconds: typeof parsed.recentSeconds === "number" && Number.isFinite(parsed.recentSeconds) ? parsed.recentSeconds : null,
    };
  } catch {
    return null;
  }
}

/** Records one pass; a quiet or failed pass keeps the last shared time and total. */
export function recordTeamShareResult(accountKey: string, organizationId: string, result: TeamAutoShareResult, now = new Date()): TeamShareStatus {
  const previous = readTeamShareStatus(accountKey, organizationId);
  const checkedAt = now.toISOString();
  const next: TeamShareStatus = result.status === "shared"
    ? { checkedAt, outcome: "shared", reason: null, error: null, sharedAt: checkedAt, recentSeconds: result.recentSeconds ?? previous?.recentSeconds ?? null }
    : {
        checkedAt,
        outcome: result.status,
        reason: result.status === "nothing" ? result.reason ?? null : null,
        error: result.status === "failed" ? result.error : null,
        sharedAt: previous?.sharedAt ?? null,
        recentSeconds: previous?.recentSeconds ?? null,
      };
  try {
    storage()?.setItem(storageKey(accountKey, organizationId), JSON.stringify(next));
  } catch {
    // A full or blocked store only loses the status line.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
  return next;
}

/** The status for one team, read again whenever a pass records a new one. */
export function useTeamShareStatus(accountKey: string | null, organizationId: string | null): TeamShareStatus | null {
  const [status, setStatus] = useState(() => readTeamShareStatus(accountKey, organizationId));
  useEffect(() => {
    setStatus(readTeamShareStatus(accountKey, organizationId));
    if (typeof window === "undefined") return undefined;
    const reread = () => setStatus(readTeamShareStatus(accountKey, organizationId));
    window.addEventListener(CHANGED_EVENT, reread);
    return () => window.removeEventListener(CHANGED_EVENT, reread);
  }, [accountKey, organizationId]);
  return status;
}
