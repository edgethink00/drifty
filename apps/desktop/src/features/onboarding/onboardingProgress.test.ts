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
  workDescription: "I build a small AI product.",
  driftAlarmEnabled: true,
  extremeNudgeEnabled: false,
  petModeEnabled: true,
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

  it("resumes a run saved on the former Welcome screen at the combined entry screen", () => {
    expect(clampOnboardingProgressStep(progressSnapshot({
      step: "welcome",
      setupChoice: null,
    }), {
      accountConnected: false,
      skipAccountStep: false,
    }).step).toBe("account");
    expect(clampOnboardingProgressStep(progressSnapshot({
      step: "account",
      setupChoice: null,
    }), {
      accountConnected: true,
      skipAccountStep: true,
    }).step).toBe("welcome");
  });

  it("resumes a run saved on the retired Nudges step at Ready", () => {
    expect(clampOnboardingProgressStep(progressSnapshot({
      step: "nudges",
      setupChoice: "simple",
    }), {
      accountConnected: true,
      skipAccountStep: false,
    }).step).toBe("ready");
    // User-managed providers still re-verify their connection before Ready.
    expect(clampOnboardingProgressStep(progressSnapshot({
      step: "nudges",
      setupChoice: "byok",
    }), {
      accountConnected: true,
      skipAccountStep: false,
    }).step).toBe("connect_server");
  });

  it("clears progress after completion", () => {
    writeOnboardingProgress("user-1", baseProgress);
    clearOnboardingProgress("user-1");

    expect(window.localStorage.getItem(getOnboardingProgressStorageKey("user-1"))).toBeNull();
  });
});
