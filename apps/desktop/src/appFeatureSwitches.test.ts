import { afterEach, describe, expect, it, vi } from "vitest";

describe("app feature switches", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps Dev-mode tools available in release builds", async () => {
    vi.stubEnv("VITE_DRIFTY_CHANNEL", "production");

    const switches = await import("./appFeatureSwitches");

    expect(switches.DRIFT_ALARM_PANEL_PREVIEWS_ENABLED).toBe(true);
    expect(switches.AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED).toBe(true);
    expect(switches.DEV_SETTINGS_ENABLED).toBe(true);
    expect(switches.DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED).toBe(true);
    expect(switches.DEVELOPER_PRE_RELEASE_UPDATES_ENABLED).toBe(true);
    expect(switches.REPLAY_ONBOARDING_DEV_TOOL_ENABLED).toBe(true);
    expect(switches.END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED).toBe(false);
    expect(switches.END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED).toBe(true);
  });

  it("does not let release-channel values change feature availability", async () => {
    vi.stubEnv("VITE_DRIFTY_CHANNEL", "internal");

    const switches = await import("./appFeatureSwitches");

    expect(switches.DRIFT_ALARM_PANEL_PREVIEWS_ENABLED).toBe(true);
    expect(switches.AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED).toBe(true);
    expect(switches.DEV_SETTINGS_ENABLED).toBe(true);
    expect(switches.DEVELOPER_PRE_RELEASE_UPDATES_ENABLED).toBe(true);
    expect(switches.REPLAY_ONBOARDING_DEV_TOOL_ENABLED).toBe(true);
    expect(switches.END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED).toBe(false);
    expect(switches.END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED).toBe(true);
  });

  it("passes through the compile-time onboarding bypass flag", async () => {
    const switches = await import("./appFeatureSwitches");

    expect(switches.resolveDevOnboardingBypass(true)).toBe(true);
    expect(switches.resolveDevOnboardingBypass(false)).toBe(false);
  });

  it("passes through the compile-time onboarding auth-step bypass flag", async () => {
    const switches = await import("./appFeatureSwitches");

    expect(switches.resolveDevOnboardingAuthBypass(true)).toBe(true);
    expect(switches.resolveDevOnboardingAuthBypass(false)).toBe(false);
  });
});
