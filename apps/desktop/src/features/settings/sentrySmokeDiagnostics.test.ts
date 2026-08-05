import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureSentryException: vi.fn(() => true),
  invoke: vi.fn(),
}));

vi.mock("../../lib/observability/sentryClient", () => ({
  captureSentryException: mocks.captureSentryException,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import { captureNativeSentrySmoke, captureRendererSentrySmoke } from "./sentrySmokeService";
import { redactSentryText } from "../../lib/observability/sentryPrivacy";

describe("Sentry smoke diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.captureSentryException.mockReturnValue(true);
  });

  it("submits a renderer exception with a searchable ID and synthetic context only", () => {
    const result = captureRendererSentrySmoke();

    expect(result.acceptedBySdk).toBe(true);
    expect(result.smokeId).toMatch(/^drifty-sentry-smoke-renderer-[0-9a-f]{24}$/);
    expect(redactSentryText(result.smokeId)).toBe(result.smokeId);
    expect(mocks.captureSentryException).toHaveBeenCalledWith(
      expect.objectContaining({ message: result.smokeId }),
      {
        tags: {
          component: "desktop-renderer",
          diagnostic: "sentry-smoke",
          smoke_id: result.smokeId,
        },
        extra: {
          smokeId: result.smokeId,
          syntheticEmail: "renderer-smoke@example.test",
          syntheticAccessToken: "synthetic-smoke-token-not-a-secret",
          syntheticUrl: "https://example.test/sentry-smoke?token=synthetic-smoke-token",
        },
      },
    );
  });

  it("passes a generated native ID to the protected Tauri command", async () => {
    mocks.invoke.mockResolvedValue({
      smokeId: "drifty-sentry-smoke-native-1234567890abcdef12345678",
      acceptedBySdk: true,
      flushCompleted: true,
    });

    await expect(captureNativeSentrySmoke()).resolves.toMatchObject({ acceptedBySdk: true });
    expect(mocks.invoke).toHaveBeenCalledWith("sentry_capture_native_smoke", {
      smokeId: expect.stringMatching(/^drifty-sentry-smoke-native-[0-9a-f]{24}$/),
    });
  });
});
