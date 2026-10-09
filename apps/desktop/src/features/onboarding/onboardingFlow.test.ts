import { describe, expect, it } from "vitest";
import {
  getOnboardingSteps,
  onboardingSetupSteps,
  remapOnboardingStepForSetupChoice,
  type SetupChoice,
} from "./onboardingFlow";

function stepIds(setupChoice: SetupChoice) {
  return getOnboardingSteps(setupChoice).map((step) => step.id);
}

describe("getOnboardingSteps", () => {
  it("opens on the sign-in entry screen and moves Setup before provider work and permissions", () => {
    expect(stepIds("simple")).toEqual([
      "account",
      "job",
      "choose_setup",
      "permissions",
      "ready",
    ]);
  });

  it("opens on the same entry screen as Welcome when sign-in is already settled", () => {
    const steps = getOnboardingSteps("simple", { skipAccountStep: true }).map((step) => step.id);
    expect(steps[0]).toBe("welcome");
    expect(steps).not.toContain("account");
    expect(steps.slice(1)).toEqual(stepIds("simple").slice(1));
  });

  it("counts only the setup steps after the entry screen in the progress dots", () => {
    expect(onboardingSetupSteps(getOnboardingSteps("simple")).map((step) => step.id)).toEqual([
      "job",
      "choose_setup",
      "permissions",
      "ready",
    ]);
    expect(onboardingSetupSteps(getOnboardingSteps("simple", { skipAccountStep: true }))[0]?.id).toBe("job");
  });

  it("keeps provider-specific preparation between Setup and Permissions", () => {
    expect(stepIds("local_ai")).toEqual([
      "account",
      "job",
      "choose_setup",
      "connect_server",
      "self_data_review",
      "permissions",
      "ready",
    ]);
    expect(stepIds("byok")).toEqual([
      "account",
      "job",
      "choose_setup",
      "connect_server",
      "test_connection",
      "self_data_review",
      "permissions",
      "ready",
    ]);
    expect(stepIds("custom_endpoint")).toEqual(stepIds("byok"));
  });

  it("goes from Permissions straight to Ready in every first-run path", () => {
    for (const setupChoice of ["simple", "local_ai", "byok", "custom_endpoint"] as const) {
      const steps = stepIds(setupChoice);
      // The drift decision moved to the intro after the first day is shown.
      expect(steps).not.toContain("nudges");
      expect(steps.indexOf("ready")).toBe(steps.indexOf("permissions") + 1);
    }
  });
});

describe("remapOnboardingStepForSetupChoice", () => {
  it("keeps a step that exists in both paths", () => {
    expect(remapOnboardingStepForSetupChoice("choose_setup", "local_ai", "simple")).toBe("choose_setup");
    expect(remapOnboardingStepForSetupChoice("permissions", "local_ai", "simple")).toBe("permissions");
  });

  it("moves connect_server to the same index on the Cloud path", () => {
    expect(remapOnboardingStepForSetupChoice("connect_server", "local_ai", "simple")).toBe("permissions");
  });
});
