const DASHBOARD_AI_RECOVERY_DISMISSAL_STORAGE_PREFIX = "drifty.dashboardAiRecovery.dismissedUntil.v1";
export const DASHBOARD_AI_RECOVERY_DISMISSAL_DURATION_MS = 36 * 60 * 60 * 1000;

export function isDashboardAiRecoveryDismissed(recoveryKey: string, nowMs = Date.now()): boolean {
  const dismissedUntil = readDashboardAiRecoveryDismissedUntil(recoveryKey);
  return dismissedUntil !== null && nowMs < dismissedUntil;
}

export function storeDashboardAiRecoveryDismissal(recoveryKey: string, nowMs = Date.now()): void {
  try {
    window.localStorage.setItem(storageKeyForRecoveryKey(recoveryKey), String(nowMs + DASHBOARD_AI_RECOVERY_DISMISSAL_DURATION_MS));
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

function readDashboardAiRecoveryDismissedUntil(recoveryKey: string): number | null {
  try {
    const rawValue = window.localStorage.getItem(storageKeyForRecoveryKey(recoveryKey));
    if (!rawValue) return null;
    const dismissedUntil = Number(rawValue);
    return Number.isFinite(dismissedUntil) ? dismissedUntil : null;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function storageKeyForRecoveryKey(recoveryKey: string): string {
  return `${DASHBOARD_AI_RECOVERY_DISMISSAL_STORAGE_PREFIX}:${recoveryKey}`;
}
