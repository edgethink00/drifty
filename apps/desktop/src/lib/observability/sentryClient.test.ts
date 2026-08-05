// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  captureSentryException: vi.fn(() => true),
  initializeSentry: vi.fn(() => true),
}));

vi.mock("./sentry", () => runtimeMocks);

describe("deferred Sentry client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    runtimeMocks.captureSentryException.mockClear();
    runtimeMocks.initializeSentry.mockClear();
    runtimeMocks.initializeSentry.mockReturnValue(true);
  });

  it("waits for browser idle time during a normal successful startup", async () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    const idleCallbacks: IdleRequestCallback[] = [];
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    const client = await import("./sentryClient");

    expect(client.scheduleSentryInitialization()).toBe(true);
    expect(client.scheduleSentryInitialization()).toBe(false);
    expect(runtimeMocks.initializeSentry).not.toHaveBeenCalled();

    idleCallbacks[0]?.({
      didTimeout: false,
      timeRemaining: () => 50,
    });

    expect(await client.initializeSentryClient()).toBe(true);
    expect(runtimeMocks.initializeSentry).toHaveBeenCalledTimes(1);
  });

  it("queues a startup exception and flushes it after the SDK loads", async () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    const client = await import("./sentryClient");
    const error = new Error("startup failed");
    const context = { tags: { phase: "startup" } };

    expect(client.captureSentryException(error, context)).toBe(false);
    expect(await client.initializeSentryClient()).toBe(true);

    expect(runtimeMocks.initializeSentry).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.captureSentryException).toHaveBeenCalledWith(error, context);
    expect(client.captureSentryException(new Error("runtime failed"))).toBe(true);
  });

  it("does not load or queue the SDK when Sentry is not configured", async () => {
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const client = await import("./sentryClient");

    expect(client.captureSentryException(new Error("ignored"))).toBe(false);
    expect(await client.initializeSentryClient()).toBe(false);
    expect(client.scheduleSentryInitialization()).toBe(false);
    expect(runtimeMocks.initializeSentry).not.toHaveBeenCalled();
    expect(runtimeMocks.captureSentryException).not.toHaveBeenCalled();
  });
});
