// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAiSetupController } from "./useAiSetupController";
import type { LocalAiSetupState } from "./localAiSetup";
import type { AiConnectionTestResult } from "./aiConnectionTest";

const storeMocks = vi.hoisted(() => ({
  loadOpenRouterApiKey: vi.fn<() => Promise<string | null>>(),
  saveOpenRouterApiKey: vi.fn<(value: string) => Promise<void>>(),
}));

vi.mock("./openRouterApiKeyStore", () => ({
  loadOpenRouterApiKey: storeMocks.loadOpenRouterApiKey,
  saveOpenRouterApiKey: storeMocks.saveOpenRouterApiKey,
}));

// Capture the controller's test-result callback so tests can inject
// connection-test verdicts, and record automatic re-test requests.
const runnerMocks = vi.hoisted(() => ({
  onLocalAiConnectionTestResult: null as ((setup: unknown, result: unknown) => void) | null,
  latestSetup: null as unknown,
  runAuto: vi.fn(async () => undefined),
}));

vi.mock("./useAiConnectionTestRunner", () => ({
  useAiConnectionTestRunner: (options: {
    localAiSetup: unknown;
    onLocalAiConnectionTestResult: (setup: unknown, result: unknown) => void;
  }) => {
    runnerMocks.onLocalAiConnectionTestResult = options.onLocalAiConnectionTestResult;
    runnerMocks.latestSetup = options.localAiSetup;
    return {
      result: null,
      running: false,
      runningFingerprint: null,
      clearResult: () => undefined,
      run: async () => undefined,
      runAuto: runnerMocks.runAuto,
    };
  },
}));

vi.mock("./managedLocalAiClient", () => ({
  getManagedLocalAiStatus: vi.fn(async () => {
    throw new Error("managed-local status unavailable in test");
  }),
}));

describe("useAiSetupController connection resilience", () => {
  beforeEach(() => {
    storeMocks.loadOpenRouterApiKey.mockReset();
    storeMocks.loadOpenRouterApiKey.mockResolvedValue("sk-or-v1-saved");
    storeMocks.saveOpenRouterApiKey.mockReset();
    storeMocks.saveOpenRouterApiKey.mockResolvedValue();
    runnerMocks.onLocalAiConnectionTestResult = null;
    runnerMocks.latestSetup = null;
    runnerMocks.runAuto.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  async function renderConnectedController() {
    const rendered = renderHook(() => useAiSetupController());
    await act(async () => {
      rendered.result.current.setLocalAiSetup((current: LocalAiSetupState) => ({
        ...current,
        provider: "openrouter_byok",
        openRouterApiKey: "sk-or-v1-saved",
      }));
    });
    await act(async () => {
      recordTestResult({ kind: "success", message: "Connected in 100 ms." });
    });
    expect(rendered.result.current.localAiProviderStatus).toEqual({ kind: "connected" });
    return rendered;
  }

  function recordTestResult(result: AiConnectionTestResult) {
    const callback = runnerMocks.onLocalAiConnectionTestResult;
    if (!callback) throw new Error("connection test callback not captured");
    callback(runnerMocks.latestSetup, result);
  }

  it("stays connected after a single classification transport failure", async () => {
    const { result } = await renderConnectedController();

    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });

    expect(result.current.localAiProviderStatus).toEqual({ kind: "connected" });
    expect(result.current.localAiConnectionPersistentFailure).toBe(false);
  });

  it("reports failed after two consecutive classification transport failures", async () => {
    const { result } = await renderConnectedController();

    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });
    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });

    expect(result.current.localAiProviderStatus).toEqual({ kind: "failed", issueKind: "network" });
    expect(result.current.localAiConnectionPersistentFailure).toBe(true);
  });

  it("treats a content-level error summary as provider contact, not a disconnect", async () => {
    const { result } = await renderConnectedController();

    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });
    await act(async () => {
      result.current.recordLocalAiClassificationSummary({
        status: "error",
        selectedSegments: 5,
        savedRecords: 0,
        message: "AI classification returned no usable classifications for 5 unknown segments.",
        failureKind: "content",
        usedAiProvider: true,
      });
    });
    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });

    // The content error reset the counter, so this is failure #1 again.
    expect(result.current.localAiProviderStatus).toEqual({ kind: "connected" });
  });

  it("ignores content-error summaries that never reached the provider", async () => {
    const { result } = await renderConnectedController();

    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });
    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });
    expect(result.current.localAiProviderStatus).toEqual({ kind: "failed", issueKind: "network" });

    // e.g. runAiClassificationUntilEmpty ending content-tagged after batches
    // that were satisfied purely by rules/reuse — no provider round-trip.
    await act(async () => {
      result.current.recordLocalAiClassificationSummary({
        status: "error",
        selectedSegments: 4,
        savedRecords: 0,
        message: "Saved 0 AI classifications. Stopped because the next batch returned no saved records.",
        failureKind: "content",
        usedAiProvider: false,
      });
    });

    expect(result.current.localAiProviderStatus).toEqual({ kind: "failed", issueKind: "network" });
  });

  it("ignores saved summaries that never reached the provider", async () => {
    const { result } = await renderConnectedController();

    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });
    await act(async () => {
      result.current.recordLocalAiClassificationError("TypeError: Failed to fetch");
    });
    expect(result.current.localAiProviderStatus).toEqual({ kind: "failed", issueKind: "network" });

    await act(async () => {
      result.current.recordLocalAiClassificationSummary({
        status: "saved",
        selectedSegments: 3,
        savedRecords: 3,
        message: "Saved 3 reused AI and 0 local classifications.",
      });
    });

    // Reused-cache saves are no evidence of connectivity; stay failed.
    expect(result.current.localAiProviderStatus).toEqual({ kind: "failed", issueKind: "network" });

    await act(async () => {
      result.current.recordLocalAiClassificationSummary({
        status: "saved",
        selectedSegments: 3,
        savedRecords: 3,
        message: "Saved 3 AI and 0 local classifications.",
        usedAiProvider: true,
      });
    });

    expect(result.current.localAiProviderStatus).toEqual({ kind: "connected" });
  });

  it("schedules an automatic re-test with backoff while failed", async () => {
    vi.useFakeTimers();
    const rendered = renderHook(() => useAiSetupController());
    act(() => {
      rendered.result.current.setLocalAiSetup((current: LocalAiSetupState) => ({
        ...current,
        provider: "openrouter_byok",
        openRouterApiKey: "sk-or-v1-saved",
      }));
    });
    act(() => {
      recordTestResult({ kind: "error", issueKind: "network", message: "Connection refused" });
    });
    expect(rendered.result.current.localAiProviderStatus).toEqual({ kind: "failed", issueKind: "network" });
    expect(runnerMocks.runAuto).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(runnerMocks.runAuto).toHaveBeenCalledTimes(1);

    // Still failed: the next probe waits for the doubled backoff delay.
    act(() => {
      recordTestResult({ kind: "error", issueKind: "network", message: "Connection refused" });
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(runnerMocks.runAuto).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(runnerMocks.runAuto).toHaveBeenCalledTimes(2);
  });

  it("honors a longer OpenRouter Retry-After delay", async () => {
    vi.useFakeTimers();
    const rendered = renderHook(() => useAiSetupController());
    act(() => {
      rendered.result.current.setLocalAiSetup((current: LocalAiSetupState) => ({
        ...current,
        provider: "openrouter_byok",
        openRouterApiKey: "sk-or-v1-saved",
      }));
    });
    act(() => {
      recordTestResult({
        kind: "error",
        issueKind: "rate_limited",
        message: "OpenRouter is rate limiting requests.",
        retryAfterMs: 90_000,
      });
    });

    act(() => {
      vi.advanceTimersByTime(89_999);
    });
    expect(runnerMocks.runAuto).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(runnerMocks.runAuto).toHaveBeenCalledTimes(1);
  });

  it("does not schedule automatic re-tests while the setup dialog is open", async () => {
    vi.useFakeTimers();
    const rendered = renderHook(() => useAiSetupController());
    act(() => {
      rendered.result.current.setLocalAiSetup((current: LocalAiSetupState) => ({
        ...current,
        provider: "openrouter_byok",
        openRouterApiKey: "sk-or-v1-saved",
      }));
    });
    act(() => {
      rendered.result.current.setAiSetupDialogOpen(true);
    });
    act(() => {
      recordTestResult({ kind: "error", issueKind: "network", message: "Connection refused" });
    });

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(runnerMocks.runAuto).not.toHaveBeenCalled();
  });

  it("re-tests immediately when the browser reports the network is back online", async () => {
    const { result } = await renderConnectedController();

    await act(async () => {
      recordTestResult({ kind: "error", issueKind: "network", message: "Connection refused" });
    });
    expect(result.current.localAiProviderStatus).toEqual({ kind: "failed", issueKind: "network" });

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(runnerMocks.runAuto).toHaveBeenCalled();
  });
});
