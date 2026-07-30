const SIDEBAR_UPGRADE_DISMISSED_UNTIL_STORAGE_KEY = "drifty.sidebarUpgrade.dismissedUntil.v1";

export const SIDEBAR_UPGRADE_DISMISSAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function readSidebarUpgradeDismissedUntil(): number | null {
  try {
    const rawValue = window.localStorage.getItem(SIDEBAR_UPGRADE_DISMISSED_UNTIL_STORAGE_KEY);
    if (!rawValue) return null;
    const dismissedUntil = Number(rawValue);
    return Number.isFinite(dismissedUntil) ? dismissedUntil : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

export function storeSidebarUpgradeDismissal(nowMs = Date.now()): number {
  const dismissedUntil = nowMs + SIDEBAR_UPGRADE_DISMISSAL_DURATION_MS;
  try {
    window.localStorage.setItem(SIDEBAR_UPGRADE_DISMISSED_UNTIL_STORAGE_KEY, String(dismissedUntil));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  return dismissedUntil;
}

export function isSidebarUpgradeDismissed(dismissedUntil: number | null, nowMs = Date.now()): boolean {
  return dismissedUntil !== null && nowMs < dismissedUntil;
}
