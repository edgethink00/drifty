// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getUserOnboardingStorageKey } from "./onboardingState";
import { hasCompletedUserOnboarding } from "./onboardingCompletion";

function storeCompletedOnboarding(userId: string) {
  window.localStorage.setItem(
    getUserOnboardingStorageKey(userId),
    JSON.stringify({
      version: 2,
      completed: true,
      displayName: "Alex",
      workType: "Software Development",
      workTypeOther: "",
      workDomain: "Tech",
      workDomainOther: "",
      jobType: null,
      jobTypeOther: "",
      driftAlarmEnabled: true,
      extremeNudgeEnabled: false,
      petModeEnabled: false,
      browserHistoryBootstrapEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-06-14T00:00:00.000Z",
    }),
  );
}

afterEach(() => window.localStorage.clear());

describe("hasCompletedUserOnboarding", () => {
  it("sees cloud onboarding without requiring the local key", () => {
    storeCompletedOnboarding("cloud-user-1");
    expect(hasCompletedUserOnboarding("local")).toBe(false);
    expect(hasCompletedUserOnboarding("cloud-user-1", ["local"])).toBe(true);
  });

  it("falls back to local onboarding after a later sign-in", () => {
    storeCompletedOnboarding("local");
    expect(hasCompletedUserOnboarding("cloud-user-1", ["local"])).toBe(true);
  });
});
