// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getUserOnboardingStorageKey, readUserOnboardingState } from "./onboardingState";

function storeCompletedOnboarding(userId: string, displayName: string) {
  window.localStorage.setItem(
    getUserOnboardingStorageKey(userId),
    JSON.stringify({
      version: 2,
      completed: true,
      displayName,
      workType: "Software Development",
      workTypeOther: "",
      workDomain: "Tech",
      workDomainOther: "",
      jobType: null,
      jobTypeOther: "",
      driftAlarmEnabled: true,
      extremeNudgeEnabled: false,
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-06-14T00:00:00.000Z",
    }),
  );
}

describe("onboardingState", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("migrates local completion when a cloud user logs in after local onboarding", () => {
    storeCompletedOnboarding("local", "Local Alex");

    const state = readUserOnboardingState("cloud-user-1", ["local"]);

    expect(state?.completed).toBe(true);
    expect(state?.displayName).toBe("Local Alex");
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("cloud-user-1"))).toBeTruthy();
  });
});
