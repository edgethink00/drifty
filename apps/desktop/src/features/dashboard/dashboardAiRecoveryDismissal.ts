const DASHBOARD_AI_RECOVERY_REMINDER_STORAGE_PREFIX = "drifty.dashboardAiRecovery.reminder.v2";
const LEGACY_DASHBOARD_AI_RECOVERY_DISMISSAL_STORAGE_PREFIX = "drifty.dashboardAiRecovery.dismissedUntil.v1";

const HOUR_MS = 60 * 60 * 1000;
export const DASHBOARD_AI_RECOVERY_REMINDER_INTERVALS_MS = [
  36 * HOUR_MS,
  48 * HOUR_MS,
  60 * HOUR_MS,
] as const;
export const DASHBOARD_AI_RECOVERY_MAX_DISMISSALS = DASHBOARD_AI_RECOVERY_REMINDER_INTERVALS_MS.length + 1;

type ScheduledDashboardAiRecoveryReminder = {
  readonly dismissalCount: number;
  readonly exhausted: false;
  readonly nextEligibleAt: number;
};

type ExhaustedDashboardAiRecoveryReminder = {
  readonly dismissalCount: number;
  readonly exhausted: true;
  readonly nextEligibleAt: null;
};

type DashboardAiRecoveryReminder = ScheduledDashboardAiRecoveryReminder | ExhaustedDashboardAiRecoveryReminder;

export function isDashboardAiRecoveryDismissed(recoveryKey: string, nowMs = Date.now()): boolean {
  const reminder = readDashboardAiRecoveryReminder(recoveryKey);
  if (!reminder) return false;
  return reminder.exhausted || nowMs < reminder.nextEligibleAt;
}

export function storeDashboardAiRecoveryDismissal(recoveryKey: string, nowMs = Date.now()): void {
  const currentReminder = readDashboardAiRecoveryReminder(recoveryKey);
  if (currentReminder && (currentReminder.exhausted || nowMs < currentReminder.nextEligibleAt)) return;

  const currentDismissalCount = currentReminder?.dismissalCount ?? 0;
  const dismissalCount = Math.min(currentDismissalCount + 1, DASHBOARD_AI_RECOVERY_MAX_DISMISSALS);
  const nextInterval = DASHBOARD_AI_RECOVERY_REMINDER_INTERVALS_MS[dismissalCount - 1] ?? null;
  const reminder: DashboardAiRecoveryReminder = nextInterval === null
    ? { dismissalCount, exhausted: true, nextEligibleAt: null }
    : { dismissalCount, exhausted: false, nextEligibleAt: nowMs + nextInterval };

  try {
    window.localStorage.setItem(storageKeyForRecoveryKey(recoveryKey), JSON.stringify(reminder));
    window.localStorage.removeItem(legacyStorageKeyForRecoveryKey(recoveryKey));
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

export function clearDashboardAiRecoveryDismissal(recoveryKey: string): void {
  try {
    window.localStorage.removeItem(storageKeyForRecoveryKey(recoveryKey));
    window.localStorage.removeItem(legacyStorageKeyForRecoveryKey(recoveryKey));
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

function readDashboardAiRecoveryReminder(recoveryKey: string): DashboardAiRecoveryReminder | null {
  try {
    const storedReminder = parseDashboardAiRecoveryReminder(
      window.localStorage.getItem(storageKeyForRecoveryKey(recoveryKey)),
    );
    if (storedReminder) return storedReminder;

    const legacyDismissedUntil = Number(window.localStorage.getItem(legacyStorageKeyForRecoveryKey(recoveryKey)));
    if (!Number.isFinite(legacyDismissedUntil) || legacyDismissedUntil <= 0) return null;
    return { dismissalCount: 1, exhausted: false, nextEligibleAt: legacyDismissedUntil };
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function parseDashboardAiRecoveryReminder(rawValue: string | null): DashboardAiRecoveryReminder | null {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<DashboardAiRecoveryReminder>;
    if (typeof candidate.dismissalCount !== "number"
      || !Number.isInteger(candidate.dismissalCount)
      || candidate.dismissalCount < 1) return null;
    if (candidate.exhausted === true
      && candidate.dismissalCount === DASHBOARD_AI_RECOVERY_MAX_DISMISSALS
      && candidate.nextEligibleAt === null) {
      return { dismissalCount: candidate.dismissalCount, exhausted: true, nextEligibleAt: null };
    }
    if (candidate.exhausted !== false
      || candidate.dismissalCount >= DASHBOARD_AI_RECOVERY_MAX_DISMISSALS
      || typeof candidate.nextEligibleAt !== "number"
      || !Number.isFinite(candidate.nextEligibleAt)) return null;
    return {
      dismissalCount: candidate.dismissalCount,
      exhausted: false,
      nextEligibleAt: candidate.nextEligibleAt,
    };
  } catch {
    return null;
  }
}

function storageKeyForRecoveryKey(recoveryKey: string): string {
  return `${DASHBOARD_AI_RECOVERY_REMINDER_STORAGE_PREFIX}:${recoveryKey}`;
}

function legacyStorageKeyForRecoveryKey(recoveryKey: string): string {
  return `${LEGACY_DASHBOARD_AI_RECOVERY_DISMISSAL_STORAGE_PREFIX}:${recoveryKey}`;
}
