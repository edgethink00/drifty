import { describe, expect, it } from "vitest";
import { getOnboardingSteps, type SetupChoice } from "./onboardingFlow";

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
      "nudges",
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
      "nudges",
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
      "nudges",
      "ready",
    ]);
    expect(stepIds("custom_endpoint")).toEqual(stepIds("byok"));
  });

  it("keeps Nudges after Permissions in every first-run path", () => {
    for (const setupChoice of ["simple", "local_ai", "byok", "custom_endpoint"] as const) {
      const steps = stepIds(setupChoice);
      expect(steps.indexOf("nudges")).toBe(steps.indexOf("permissions") + 1);
      expect(steps.indexOf("ready")).toBe(steps.indexOf("nudges") + 1);
    }
  });
});
