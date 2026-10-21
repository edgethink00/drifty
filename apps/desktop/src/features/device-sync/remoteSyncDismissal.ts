const key = (accountId: string) => `drifty.deviceSync.remoteDismiss.v1.${encodeURIComponent(accountId)}`;

/** Persist OFF before network work. Reconnection first retires pending consent,
 * including a request the receiver has not yet observed. */
export function markRemoteSyncDismissal(accountId: string | null): void {
  if (accountId) localStorage.setItem(key(accountId), crypto.randomUUID());
}
export function readRemoteSyncDismissal(accountId: string): string | null {
  return localStorage.getItem(key(accountId));
}
export function clearRemoteSyncDismissal(accountId: string, token: string): void {
  if (readRemoteSyncDismissal(accountId) === token) localStorage.removeItem(key(accountId));
}
