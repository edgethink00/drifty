const key = (accountId: string) => `drifty.deviceSync.stoppedFromPhone.v1.${encodeURIComponent(accountId)}`;

/** Remembers that the iPhone turned this computer off until the person turns sync on again. */
export function markDeviceSyncStoppedFromPhone(accountId: string | null): void {
  if (accountId) localStorage.setItem(key(accountId), new Date().toISOString());
}
export function readDeviceSyncStoppedFromPhone(accountId: string | null): boolean {
  return accountId ? localStorage.getItem(key(accountId)) !== null : false;
}
export function clearDeviceSyncStoppedFromPhone(accountId: string | null): void {
  if (accountId) localStorage.removeItem(key(accountId));
}
