// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearOnboardingProgress,
  clampOnboardingProgressStep,
  getOnboardingProgressStorageKey,
  readOnboardingProgress,
  writeOnboardingProgress,
  type OnboardingProgressInput,
  type OnboardingProgressSnapshot,
} from "./onboardingProgress";

const baseProgress: OnboardingProgressInput = {
  step: "connect_server",
  setupChoice: "byok",
  mainActivities: ["Coding", "Writing"],
  mainActivityOther: "",
  workType: null,
  workTypeOther: "",
  workDomain: "AI",
  workDomainOther: "",
  driftAlarmEnabled: true,
  extremeNudgeEnabled: false,
  openAtLoginEnabled: true,
  customEndpointDraft: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2:latest",
  },
};

function progressSnapshot(overrides: Partial<OnboardingProgressInput> = {}): OnboardingProgressSnapshot {
  return {
    version: 1,
    ...baseProgress,
    ...overrides,
    savedAt: "2026-07-03T00:00:00.000Z",
  };
}

describe("onboardingProgress", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("round-trips resumable onboarding fields without secret material", () => {
    writeOnboardingProgress("user-1", baseProgress, new Date("2026-07-03T00:00:00.000Z"));

    const storedValue = window.localStorage.getItem(getOnboardingProgressStorageKey("user-1")) ?? "";
    expect(storedValue).toContain("connect_server");
    expect(storedValue).not.toContain("sk-or");
    expect(readOnboardingProgress("user-1", new Date("2026-07-04T00:00:00.000Z"))).toMatchObject({
      ...baseProgress,
      savedAt: "2026-07-03T00:00:00.000Z",
    });
  });

  it("ignores stale progress after seven days", () => {
    writeOnboardingProgress("user-1", baseProgress, new Date("2026-07-01T00:00:00.000Z"));

    expect(readOnboardingProgress("user-1", new Date("2026-07-09T00:00:01.000Z"))).toBeNull();
  });

  it("rewinds user-managed connection review steps to connect_server", () => {
    expect(clampOnboardingProgressStep(progressSnapshot({
      step: "self_data_review",
    }), {
      accountConnected: true,
      skipAccountStep: false,
    }).step).toBe("connect_server");
  });

  it("rewinds later steps when the account is not connected", () => {
    expect(clampOnboardingProgressStep(progressSnapshot({
      step: "choose_setup",
    }), {
      accountConnected: false,
      skipAccountStep: false,
    }).step).toBe("account");
  });

  it("keeps an in-progress Nudges step on Nudges", () => {
    expect(clampOnboardingProgressStep(progressSnapshot({
      step: "nudges",
      setupChoice: "simple",
    }), {
      accountConnected: true,
      skipAccountStep: false,
    }).step).toBe("nudges");
  });

  it("clears progress after completion", () => {
    writeOnboardingProgress("user-1", baseProgress);
    clearOnboardingProgress("user-1");

    expect(window.localStorage.getItem(getOnboardingProgressStorageKey("user-1"))).toBeNull();
  });
});
