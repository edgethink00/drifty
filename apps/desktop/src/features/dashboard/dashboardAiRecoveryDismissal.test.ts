// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_AI_RECOVERY_DISMISSAL_DURATION_MS,
  isDashboardAiRecoveryDismissed,
  storeDashboardAiRecoveryDismissal,
} from "./dashboardAiRecoveryDismissal";

describe("dashboard AI recovery dismissal", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("suppresses the same dashboard recovery for 36 hours", () => {
    const recoveryKey = "trial-ended";
    const dismissedAt = 1_000;

    storeDashboardAiRecoveryDismissal(recoveryKey, dismissedAt);

    expect(isDashboardAiRecoveryDismissed(
      recoveryKey,
      dismissedAt + DASHBOARD_AI_RECOVERY_DISMISSAL_DURATION_MS - 1,
    )).toBe(true);
    expect(isDashboardAiRecoveryDismissed(
      recoveryKey,
      dismissedAt + DASHBOARD_AI_RECOVERY_DISMISSAL_DURATION_MS,
    )).toBe(false);
  });
});
