import { afterEach, describe, expect, it, vi } from "vitest";

describe("app feature switches", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps production as the only release channel that disables background prototypes while keeping Dev-mode tools available", async () => {
    vi.stubEnv("VITE_DRIFTY_CHANNEL", "production");

    const switches = await import("./appFeatureSwitches");

    expect(switches.RELEASE_CHANNEL).toBe("production");
    expect(switches.IS_PRODUCTION_BUILD).toBe(true);
    expect(switches.WATCHER_PEEK_PROTOTYPE_ENABLED).toBe(false);
    expect(switches.DRIFT_ALARM_PANEL_PREVIEWS_ENABLED).toBe(true);
    expect(switches.AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED).toBe(true);
    expect(switches.DEV_SETTINGS_ENABLED).toBe(true);
    expect(switches.DEVELOPER_PRE_RELEASE_UPDATES_ENABLED).toBe(true);
    expect(switches.REPLAY_ONBOARDING_DEV_TOOL_ENABLED).toBe(true);
    expect(switches.END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED).toBe(false);
    expect(switches.END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED).toBe(true);
  });

  it("treats beta as an unsupported channel and falls back to dev", async () => {
    vi.stubEnv("VITE_DRIFTY_CHANNEL", "beta");

    const switches = await import("./appFeatureSwitches");

    expect(switches.RELEASE_CHANNEL).toBe("dev");
    expect(switches.IS_PRODUCTION_BUILD).toBe(false);
    expect(switches.WATCHER_PEEK_PROTOTYPE_ENABLED).toBe(true);
    expect(switches.DRIFT_ALARM_PANEL_PREVIEWS_ENABLED).toBe(true);
    expect(switches.AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED).toBe(true);
    expect(switches.DEV_SETTINGS_ENABLED).toBe(true);
    expect(switches.DEVELOPER_PRE_RELEASE_UPDATES_ENABLED).toBe(true);
    expect(switches.REPLAY_ONBOARDING_DEV_TOOL_ENABLED).toBe(true);
    expect(switches.END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED).toBe(false);
    expect(switches.END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED).toBe(true);
  });

  it("keeps the onboarding bypass dev-only even when the raw skip flag is present", async () => {
    const switches = await import("./appFeatureSwitches");

    expect(switches.resolveDevOnboardingBypass("dev", true)).toBe(true);
    expect(switches.resolveDevOnboardingBypass("dev", false)).toBe(false);
    expect(switches.resolveDevOnboardingBypass("production", true)).toBe(false);
  });
});
