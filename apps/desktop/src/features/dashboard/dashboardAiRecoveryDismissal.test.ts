// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearDashboardAiRecoveryDismissal,
  DASHBOARD_AI_RECOVERY_MAX_DISMISSALS,
  DASHBOARD_AI_RECOVERY_REMINDER_INTERVALS_MS,
  isDashboardAiRecoveryDismissed,
  storeDashboardAiRecoveryDismissal,
} from "./dashboardAiRecoveryDismissal";

describe("dashboard AI recovery reminder", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("allows the initial notice and 36, 48, and 60 hour reminders, then stops after the fourth dismissal", () => {
    const recoveryKey = "trial-ended";
    let dismissedAt = 1_000;
    const expectedIntervals = [
      36 * 60 * 60 * 1000,
      48 * 60 * 60 * 1000,
      60 * 60 * 60 * 1000,
    ];

    expect(DASHBOARD_AI_RECOVERY_REMINDER_INTERVALS_MS).toEqual(expectedIntervals);
    expect(DASHBOARD_AI_RECOVERY_MAX_DISMISSALS).toBe(4);
    expect(isDashboardAiRecoveryDismissed(recoveryKey, dismissedAt)).toBe(false);

    for (const interval of expectedIntervals) {
      storeDashboardAiRecoveryDismissal(recoveryKey, dismissedAt);
      expect(isDashboardAiRecoveryDismissed(recoveryKey, dismissedAt + interval - 1)).toBe(true);
      expect(isDashboardAiRecoveryDismissed(recoveryKey, dismissedAt + interval)).toBe(false);
      dismissedAt += interval;
    }

    storeDashboardAiRecoveryDismissal(recoveryKey, dismissedAt);
    expect(isDashboardAiRecoveryDismissed(recoveryKey, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("does not advance the reminder schedule for duplicate dismissals during the same wait", () => {
    const recoveryKey = "trial-ended";
    const dismissedAt = 1_000;
    const firstInterval = 36 * 60 * 60 * 1000;

    storeDashboardAiRecoveryDismissal(recoveryKey, dismissedAt);
    storeDashboardAiRecoveryDismissal(recoveryKey, dismissedAt + 1);

    expect(isDashboardAiRecoveryDismissed(recoveryKey, dismissedAt + firstInterval)).toBe(false);
  });

  it("continues an existing 36-hour dismissal as the first reminder interval", () => {
    const recoveryKey = "trial-ended";
    const legacyDismissedUntil = 5_000;
    window.localStorage.setItem(
      `drifty.dashboardAiRecovery.dismissedUntil.v1:${recoveryKey}`,
      String(legacyDismissedUntil),
    );

    expect(isDashboardAiRecoveryDismissed(recoveryKey, legacyDismissedUntil - 1)).toBe(true);
    expect(isDashboardAiRecoveryDismissed(recoveryKey, legacyDismissedUntil)).toBe(false);

    storeDashboardAiRecoveryDismissal(recoveryKey, legacyDismissedUntil);
    const secondInterval = DASHBOARD_AI_RECOVERY_REMINDER_INTERVALS_MS[1];
    expect(isDashboardAiRecoveryDismissed(recoveryKey, legacyDismissedUntil + secondInterval - 1)).toBe(true);
    expect(isDashboardAiRecoveryDismissed(recoveryKey, legacyDismissedUntil + secondInterval)).toBe(false);
    expect(window.localStorage.getItem(`drifty.dashboardAiRecovery.dismissedUntil.v1:${recoveryKey}`)).toBeNull();
  });

  it("keeps reminder schedules independent by recovery reason", () => {
    storeDashboardAiRecoveryDismissal("trial-ended", 1_000);

    expect(isDashboardAiRecoveryDismissed("trial-ended", 1_001)).toBe(true);
    expect(isDashboardAiRecoveryDismissed("cloud-billing", 1_001)).toBe(false);
  });

  it("rejects stored states that contradict the four-dismissal schedule", () => {
    const recoveryKey = "trial-ended";
    const storageKey = `drifty.dashboardAiRecovery.reminder.v2:${recoveryKey}`;
    const impossibleStates = [
      { dismissalCount: 1, exhausted: true, nextEligibleAt: null },
      { dismissalCount: 4, exhausted: false, nextEligibleAt: 5_000 },
      { dismissalCount: 4, exhausted: true, nextEligibleAt: 5_000 },
      { dismissalCount: 5, exhausted: true, nextEligibleAt: null },
    ];

    for (const state of impossibleStates) {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      expect(isDashboardAiRecoveryDismissed(recoveryKey, 1_001)).toBe(false);
    }
  });

  it("clears both current and legacy reminder state", () => {
    const recoveryKey = "trial-ended";
    storeDashboardAiRecoveryDismissal(recoveryKey, 1_000);
    window.localStorage.setItem(
      `drifty.dashboardAiRecovery.dismissedUntil.v1:${recoveryKey}`,
      "5000",
    );

    clearDashboardAiRecoveryDismissal(recoveryKey);

    expect(isDashboardAiRecoveryDismissed(recoveryKey, 1_001)).toBe(false);
    expect(window.localStorage.getItem(`drifty.dashboardAiRecovery.reminder.v2:${recoveryKey}`)).toBeNull();
    expect(window.localStorage.getItem(`drifty.dashboardAiRecovery.dismissedUntil.v1:${recoveryKey}`)).toBeNull();
  });
});
