import { useEffect, useState } from "react";
import type { FriendInvite, FriendInviteResult } from "../billing/billingService";

/**
 * The signed-in account's friend invite, shared by the Settings card and the
 * account menu shortcut so both agree on whether invites are open. Each mount
 * re-reads (claims change), concurrent reads for one account share a request,
 * a transient failure keeps the invite that account already saw, and nothing
 * ever crosses accounts.
 */
const cache = new Map<string, FriendInvite | null>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

export type FriendInviteLoader = () => Promise<FriendInviteResult>;

function refresh(accountKey: string, loadInvite: FriendInviteLoader): Promise<void> {
  const pending = inFlight.get(accountKey);
  if (pending) return pending;
  const next = loadInvite().then((result) => {
    if (result.kind === "unavailable" && cache.has(accountKey)) return;
    cache.set(accountKey, result.kind === "ready" ? result.invite : null);
  }, () => {
    if (!cache.has(accountKey)) cache.set(accountKey, null);
  }).finally(() => {
    inFlight.delete(accountKey);
    for (const listener of listeners) listener();
  });
  inFlight.set(accountKey, next);
  return next;
}

/** Null while unknown, when invites are off, or for an inactive code. */
export function useFriendInvite(accountKey: string | null, loadInvite: FriendInviteLoader | null): FriendInvite | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (accountKey && loadInvite) void refresh(accountKey, loadInvite);
  }, [accountKey, loadInvite]);
  if (!accountKey || !loadInvite) return null;
  const invite = cache.get(accountKey) ?? null;
  return invite && invite.status !== "inactive" ? invite : null;
}

/** The account key both surfaces use, so they read the same entry. */
export function friendInviteAccountKey(userEmail: string | null | undefined): string {
  return userEmail?.trim() || "signed-in";
}

/** True while the account can still enter a friend's code (its first 14 days). */
export function canEnterFriendCode(invite: FriendInvite, now: number = Date.now()): boolean {
  if (!invite.codeEntryUntil) return false;
  const until = Date.parse(invite.codeEntryUntil);
  return Number.isFinite(until) && now < until;
}
