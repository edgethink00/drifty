// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  getUserOnboardingStorageKey,
  readUserOnboardingState,
  readUserWorkProfileSettings,
  saveUserWorkProfileSettings,
  summarizeUserWorkProfile,
} from "./onboardingState";

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

  it("preserves multiple work activities for AI work profile settings", () => {
    storeCompletedOnboarding("local", "Local Alex");

    const savedState = saveUserWorkProfileSettings("local", {
      workActivities: ["Coding", "Writing"],
      workActivityOther: "",
      workDomain: "AI",
      workDomainOther: "",
      workDescription: "I build product features and help customers.",
    });

    expect(savedState).toMatchObject({
      workType: "Coding",
      workTypeOther: "",
      jobType: "Coding, Writing",
      jobTypeOther: "",
      workDomain: null,
      workDescription: "I build product features and help customers.",
    });
    expect(readUserWorkProfileSettings("local").workActivities).toEqual(["Coding", "Writing"]);
    expect(readUserWorkProfileSettings("local").workDescription).toBe("I build product features and help customers.");
    expect(summarizeUserWorkProfile("local")).toBe("Coding, Writing. I build product features and help customers.");
  });

  it("moves a legacy field into the description when the description is empty", () => {
    storeCompletedOnboarding("local", "Local Alex");

    expect(readUserWorkProfileSettings("local")).toMatchObject({
      workActivities: ["Software Development"],
      workDomain: null,
      workDomainOther: "",
      workDescription: "Works in Tech.",
    });
    expect(summarizeUserWorkProfile("local")).toBe("Software Development. Works in Tech.");
  });

  it("does not overwrite an existing description with the legacy field", () => {
    storeCompletedOnboarding("local", "Local Alex");
    const key = getUserOnboardingStorageKey("local");
    const current = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(key, JSON.stringify({ ...current, workDescription: "I already described my work." }));
    expect(readUserWorkProfileSettings("local").workDescription).toBe("I already described my work.");
  });

  it("persists a migrated field into the description and clears the stored field", () => {
    storeCompletedOnboarding("local", "Local Alex");
    const savedState = saveUserWorkProfileSettings("local", readUserWorkProfileSettings("local"));
    expect(savedState).toMatchObject({
      workDomain: null,
      workDomainOther: "",
      workDescription: "Works in Tech.",
    });
    const stored = JSON.parse(window.localStorage.getItem(getUserOnboardingStorageKey("local")) ?? "{}") as Record<string, unknown>;
    expect(stored.workDomain).toBeNull();
    expect(stored.workDescription).toBe("Works in Tech.");
  });

  it("caps stored work activities at four", () => {
    storeCompletedOnboarding("local", "Local Alex");
    const savedState = saveUserWorkProfileSettings("local", {
      workActivities: ["Coding", "Writing", "Designing", "Data Analysis", "Operations"],
      workActivityOther: "",
      workDomain: null,
      workDomainOther: "",
      workDescription: "I ship product work.",
    });
    expect(savedState?.jobType).toBe("Coding, Writing, Designing, Data Analysis");
    expect(readUserWorkProfileSettings("local").workActivities).toEqual([
      "Coding",
      "Writing",
      "Designing",
      "Data Analysis",
    ]);
  });

  it("migrates an empty description from a legacy field in Korean preview", () => {
    storeCompletedOnboarding("local", "Local Alex");
    window.localStorage.setItem("drifty.dev.mode", "1");
    window.localStorage.setItem("drifty.dev.koreanLocalizationPreview", "1");
    window.localStorage.setItem("drifty.displayLanguage", "ko");
    expect(readUserWorkProfileSettings("local").workDescription).toBe("Tech 분야에서 일합니다.");
  });

  it("refuses to create an onboarding-completed record from a work profile save alone", () => {
    const savedState = saveUserWorkProfileSettings("local", {
      workActivities: ["Coding"],
      workActivityOther: "",
      workDomain: "AI",
      workDomainOther: "",
      workDescription: "",
    });

    expect(savedState).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("local"))).toBeNull();
    expect(readUserOnboardingState("local")).toBeNull();
  });
});
