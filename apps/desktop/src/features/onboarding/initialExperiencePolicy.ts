import { logicalDayIsoDateForDate } from "@drifty/domain";

export const INSTALL_DAY_REVIEW_CUTOFF_MINUTE = 15 * 60 + 30;
export const INITIAL_DAILY_FOCUS_QUIET_PERIOD_MS = 15 * 60 * 1000;

/**
 * A late install has not observed enough of the user's day to interrupt them
 * with a same-day review. Existing users, and users whose onboarding completed
 * on an earlier logical day, keep the normal review schedule.
 */
export function isInstallDayReviewEligible(
  onboardingCompletedAt: string | null,
  reviewDay: string,
  startOfDayMinutes = 0,
): boolean {
  if (!onboardingCompletedAt) return true;
  const completedAt = new Date(onboardingCompletedAt);
  if (!Number.isFinite(completedAt.getTime())) return true;
  if (logicalDayIsoDateForDate(completedAt, startOfDayMinutes) !== reviewDay) return true;

  const completedMinute = completedAt.getHours() * 60 + completedAt.getMinutes();
  return completedMinute < INSTALL_DAY_REVIEW_CUTOFF_MINUTE;
}

/**
 * Daily focus milestones still advance during this window, but they are
 * consumed silently so onboarding/imported history cannot create an immediate
 * celebration or a delayed catch-up alert.
 */
export function isInitialDailyFocusQuietPeriod(
  onboardingCompletedAt: string | null,
  nowMs = Date.now(),
): boolean {
  if (!onboardingCompletedAt) return false;
  const completedAtMs = Date.parse(onboardingCompletedAt);
  if (!Number.isFinite(completedAtMs) || !Number.isFinite(nowMs)) return false;
  const elapsedMs = nowMs - completedAtMs;
  return elapsedMs >= 0 && elapsedMs < INITIAL_DAILY_FOCUS_QUIET_PERIOD_MS;
}
