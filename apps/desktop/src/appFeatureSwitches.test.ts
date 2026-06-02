import { afterEach, describe, expect, it, vi } from "vitest";

describe("app feature switches", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps production as the only release channel that disables prototypes", async () => {
    vi.stubEnv("VITE_DRIFTY_CHANNEL", "production");

    const switches = await import("./appFeatureSwitches");

    expect(switches.RELEASE_CHANNEL).toBe("production");
    expect(switches.IS_PRODUCTION_BUILD).toBe(true);
    expect(switches.WATCHER_PEEK_PROTOTYPE_ENABLED).toBe(false);
  });

  it("treats beta as an unsupported channel and falls back to dev", async () => {
    vi.stubEnv("VITE_DRIFTY_CHANNEL", "beta");

    const switches = await import("./appFeatureSwitches");

    expect(switches.RELEASE_CHANNEL).toBe("dev");
    expect(switches.IS_PRODUCTION_BUILD).toBe(false);
    expect(switches.WATCHER_PEEK_PROTOTYPE_ENABLED).toBe(true);
  });
});
