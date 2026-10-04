import { describe, expect, it } from "vitest";
import { getOnboardingSteps, remapOnboardingStepForSetupChoice, type SetupChoice } from "./onboardingFlow";

function stepIds(setupChoice: SetupChoice) {
  return getOnboardingSteps(setupChoice).map((step) => step.id);
}

describe("getOnboardingSteps", () => {
  it("keeps Account second and moves Setup before provider work and permissions", () => {
    expect(stepIds("simple")).toEqual([
      "welcome",
      "account",
      "job",
      "choose_setup",
      "permissions",
      "ready",
    ]);
  });

  it("keeps provider-specific preparation between Setup and Permissions", () => {
    expect(stepIds("local_ai")).toEqual([
      "welcome",
      "account",
      "job",
      "choose_setup",
      "connect_server",
      "self_data_review",
      "permissions",
      "ready",
    ]);
    expect(stepIds("byok")).toEqual([
      "welcome",
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
