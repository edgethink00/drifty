// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { checkMock, invokeMock } = vi.hoisted(() => ({ checkMock: vi.fn(), invokeMock: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./updatePolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./updatePolicy")>();
  return { ...actual, fetchUpdatePolicy: vi.fn(async (version: string) => actual.fallbackUpdatePolicy(version)) };
});
import { acquireUpdateOperation, pauseUpdatesForVersionTest, resumeUpdatesAfterVersionTest } from "./versionSwitchState";
import { useUpdateController } from "./useUpdateController";
import { POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY, fetchUpdatePolicy, fallbackUpdatePolicy } from "./updatePolicy";
type DownloadEvent =
  | { readonly event: "Started"; readonly data: { readonly contentLength?: number } }
  | { readonly event: "Progress"; readonly data: { readonly chunkLength: number } }
  | { readonly event: "Finished" };
function update(version = "1.10.9") {
  return { version, body: null, close: vi.fn().mockResolvedValue(undefined), download: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn().mockResolvedValue(undefined) };
}
function restartInvocations() {
  return invokeMock.mock.calls.filter((call) => call[0] === "app_restart_after_update");
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); invokeMock.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); localStorage.clear(); });
describe("manual and automatic update interaction", () => {
  it("offers a manual update immediately and dismisses it without installing", async () => {
    const release = update(); checkMock.mockResolvedValue(release);
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates("manual"); });
    expect(result.current.availableUpdateSource).toBe("manual");
    expect(result.current.shouldShowAvailableUpdateDialog).toBe(true);
    act(() => result.current.dismissAvailableUpdate());
    expect(result.current.shouldShowAvailableUpdateDialog).toBe(false);
    expect(release.downloadAndInstall).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
  it("keeps a first automatic general update quiet", async () => {
    checkMock.mockResolvedValue(update());
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    expect(result.current.availableUpdateSource).toBe("automatic");
    expect(result.current.shouldShowAvailableUpdateDialog).toBe(false);
  });
  it("promotes an in-flight scheduled check when the user asks manually", async () => {
    let resolve!: (value: ReturnType<typeof update>) => void;
    checkMock.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));
    let automatic!: Promise<unknown>;
    act(() => { automatic = result.current.handleCheckForUpdates("automatic"); });
    await act(async () => { await result.current.handleCheckForUpdates("manual"); });
    expect(result.current.updaterChecking).toBe(true);
    const release = update();
    await act(async () => { resolve(release); await automatic; });
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(result.current.availableUpdateSource).toBe("manual");
    expect(result.current.shouldShowAvailableUpdateDialog).toBe(true);
    expect(result.current.updaterChecking).toBe(false);
    expect(release.download).not.toHaveBeenCalled();
  });
  it("exposes an up-to-date result after a manual click during a scheduled check", async () => {
    let resolve!: (value: null) => void;
    checkMock.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    let automatic!: Promise<unknown>;
    act(() => { automatic = result.current.handleCheckForUpdates("automatic"); });
    await act(async () => { await result.current.handleCheckForUpdates("manual"); });
    await act(async () => { resolve(null); await automatic; });
    expect(result.current.updaterMessage).toBe("Drifty is up to date.");
    expect(result.current.updaterChecking).toBe(false);
  });
  it("allows retry after a failed manual check", async () => {
    checkMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(update());
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates(); });
    expect(result.current.updaterError).toContain("offline");
    await act(async () => { await result.current.handleCheckForUpdates(); });
    expect(result.current.updaterError).toBeNull();
    expect(result.current.shouldShowAvailableUpdateDialog).toBe(true);
  });
  it("checks the current release again before explicit install and only then restarts", async () => {
    const old = update("1.10.9"), latest = update("1.10.10");
    checkMock.mockResolvedValueOnce(old).mockResolvedValueOnce(latest);
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates(); });
    await act(async () => { await result.current.handleInstallUpdate(); });
    expect(old.downloadAndInstall).not.toHaveBeenCalled();
    expect(latest.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update", { silent: false });
    expect(localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBe("1");
  });
  it("does not restart on failed installation", async () => {
    const release = update(); release.downloadAndInstall.mockRejectedValue(new Error("signature mismatch"));
    checkMock.mockResolvedValue(release);
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates(); });
    await act(async () => { await result.current.handleInstallUpdate(); });
    expect(result.current.updaterError).toContain("signature mismatch");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBeNull();
  });
  it("reports the update transfer instead of leaving a blank Preparing button", async () => {
    let emit: ((event: DownloadEvent) => void) | undefined;
    let finishTransfer!: () => void;
    const release = update();
    release.downloadAndInstall = vi.fn((onEvent?: (event: DownloadEvent) => void) => new Promise<void>((resolve) => {
      emit = onEvent;
      finishTransfer = () => resolve();
    }));
    checkMock.mockResolvedValue(release);
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates(); });

    let installed!: Promise<unknown>;
    act(() => { installed = result.current.handleInstallUpdate(); });
    await waitFor(() => expect(release.downloadAndInstall).toHaveBeenCalledTimes(1));

    act(() => emit?.({ event: "Started", data: { contentLength: 1_000 } }));
    expect(result.current.updaterDownloadProgress).toBe(0);
    act(() => emit?.({ event: "Progress", data: { chunkLength: 400 } }));
    expect(result.current.updaterDownloadProgress).toBeCloseTo(0.4, 5);
    act(() => emit?.({ event: "Progress", data: { chunkLength: 400 } }));
    expect(result.current.updaterDownloadProgress).toBeCloseTo(0.8, 5);
    act(() => emit?.({ event: "Finished" }));
    expect(result.current.updaterDownloadProgress).toBe(1);

    await act(async () => { finishTransfer(); await installed; });
    expect(result.current.updaterDownloadProgress).toBeNull();
  });
  it("invents no percentage when the update source reports no size", async () => {
    let emit: ((event: DownloadEvent) => void) | undefined;
    let finishTransfer!: () => void;
    const release = update();
    release.downloadAndInstall = vi.fn((onEvent?: (event: DownloadEvent) => void) => new Promise<void>((resolve) => {
      emit = onEvent;
      finishTransfer = () => resolve();
    }));
    checkMock.mockResolvedValue(release);
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates(); });

    let installed!: Promise<unknown>;
    act(() => { installed = result.current.handleInstallUpdate(); });
    await waitFor(() => expect(release.downloadAndInstall).toHaveBeenCalledTimes(1));

    act(() => emit?.({ event: "Started", data: {} }));
    act(() => emit?.({ event: "Progress", data: { chunkLength: 400 } }));
    expect(result.current.updaterDownloadProgress).toBeNull();

    await act(async () => { finishTransfer(); await installed; });
  });
  it("releases the native resource after unmount", async () => {
    const release = update(); checkMock.mockResolvedValue(release);
    const { result, unmount } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates(); });
    unmount();
    await waitFor(() => expect(release.close).toHaveBeenCalledTimes(1));
  });
});


describe("version testing coordination", () => {
  it("suppresses automatic checks during a pause but keeps manual recovery available", async () => {
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));
    act(() => pauseUpdatesForVersionTest());
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    expect(checkMock).not.toHaveBeenCalled();
    expect(result.current.backgroundUpdatesEnabled).toBe(false);
    checkMock.mockResolvedValue(null);
    await act(async () => { await result.current.handleCheckForUpdates("manual"); });
    expect(checkMock).toHaveBeenCalledTimes(1);
    act(() => resumeUpdatesAfterVersionTest());
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    expect(checkMock).toHaveBeenCalledTimes(2);
  });
  it("discards an automatic result that arrives after the test pause starts", async () => {
    let resolve!: (value: ReturnType<typeof update>) => void;
    checkMock.mockReturnValue(new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.handleCheckForUpdates("automatic"); });
    act(() => pauseUpdatesForVersionTest());
    const next = update();
    await act(async () => { resolve(next); await pending; });
    expect(next.download).not.toHaveBeenCalled();
    expect(next.close).toHaveBeenCalled();
    expect(result.current.availableUpdate).toBeNull();
  });
  it("does not install stable updates while another channel owns the installer", async () => {
    const next = update(); checkMock.mockResolvedValue(next);
    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: false }));
    await act(async () => { await result.current.handleCheckForUpdates("manual"); });
    const release = acquireUpdateOperation();
    try { await act(async () => { await result.current.handleInstallUpdate(); });
      expect(next.downloadAndInstall).not.toHaveBeenCalled();
    } finally { release?.(); }
  });
});

it("allows an explicitly selected stable recovery install while the seven-day pause remains active", async () => {
  const next = update("1.11.0"); checkMock.mockResolvedValue(next);
  const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));
  act(() => pauseUpdatesForVersionTest());
  const deadline = localStorage.getItem("drifty.updates.nextAutomaticCheckAt.v1");
  await act(async () => { await result.current.handleCheckForUpdates("manual"); });
  expect(result.current.shouldShowAvailableUpdateDialog).toBe(true);
  expect(next.download).not.toHaveBeenCalled();
  await act(async () => { await result.current.handleInstallUpdate(); });
  expect(next.downloadAndInstall).toHaveBeenCalledTimes(1);
  expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update", { silent: false });
  expect(localStorage.getItem("drifty.updates.nextAutomaticCheckAt.v1")).toBe(deadline);
  expect(localStorage.getItem("drifty.updates.backgroundApply.v2")).toBe("0");
});

it("discards a scheduled update when the pause begins during policy loading", async () => {
  const next = update("1.11.0"); checkMock.mockResolvedValue(next);
  let finish!: (policy: ReturnType<typeof fallbackUpdatePolicy>) => void;
  vi.mocked(fetchUpdatePolicy).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.handleCheckForUpdates("automatic"); });
  await waitFor(() => expect(fetchUpdatePolicy).toHaveBeenCalledWith("1.11.0"));
  act(() => pauseUpdatesForVersionTest());
  await act(async () => { finish(fallbackUpdatePolicy("1.11.0")); await pending; });
  expect(result.current.availableUpdate).toBeNull();
  expect(next.close).toHaveBeenCalledTimes(1);
  expect(next.download).not.toHaveBeenCalled();
  expect(next.install).not.toHaveBeenCalled();
});

describe("background update and idle auto-restart", () => {
  it("prepares an eligible update in the background without showing dialog", async () => {
    const next = update("1.11.6");
    checkMock.mockResolvedValue(next);
    vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
      version: "1.11.6",
      policyVersion: 2,
      urgency: "general",
      promptAfterMs: 72 * 60 * 60 * 1000,
      backgroundDownloadEligible: true,
      installBehavior: "next-launch",
      message: null,
    });

    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));
    await act(async () => {
      await result.current.handleCheckForUpdates("automatic");
    });

    expect(result.current.shouldShowAvailableUpdateDialog).toBe(false);
    expect(result.current.canAutoUpdateSilently).toBe(true);
    expect(result.current.preparedUpdateVersion).toBe("1.11.6");
    expect(next.download).toHaveBeenCalledTimes(1);
    expect(next.install).toHaveBeenCalledTimes(1);
  });

  it("restarts automatically when idle threshold is reached after update is prepared", async () => {
    vi.useFakeTimers();
    try {
      const next = update("1.11.6");
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
        version: "1.11.6",
        policyVersion: 2,
        urgency: "general",
        promptAfterMs: 72 * 60 * 60 * 1000,
        backgroundDownloadEligible: true,
        installBehavior: "next-launch",
        message: null,
      });

      let idleSec = 0;
      const getIdleSeconds = vi.fn(async () => idleSec);
      const canSafelyRestart = vi.fn(() => true);

      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        getIdleSeconds,
        canSafelyRestart,
      }));

      await act(async () => {
        await result.current.handleCheckForUpdates("automatic");
      });

      expect(result.current.preparedUpdateVersion).toBe("1.11.6");
      expect(restartInvocations()).toHaveLength(0);

      // Advance timer while user is active
      idleSec = 60; // 1 min
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(restartInvocations()).toHaveLength(0);

      // User becomes idle for 15+ minutes
      idleSec = 15 * 60 + 1;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update", { silent: true });
      expect(localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBeNull();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the idle check alive when parent callbacks are recreated every render", async () => {
    vi.useFakeTimers();
    try {
      const next = update("1.11.6");
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
        version: "1.11.6",
        policyVersion: 2,
        urgency: "general",
        promptAfterMs: 72 * 60 * 60 * 1000,
        backgroundDownloadEligible: true,
        installBehavior: "next-launch",
        message: null,
      });
      const getIdleSeconds = vi.fn(async () => 20 * 60);
      const { result, rerender, unmount } = renderHook(
        ({ nonce }: { nonce: number }) => useUpdateController({
          backgroundPreparationSupported: true,
          getIdleSeconds: async () => {
            void nonce;
            return getIdleSeconds();
          },
          canSafelyRestart: () => {
            void nonce;
            return true;
          },
        }),
        { initialProps: { nonce: 0 } },
      );
      await act(async () => {
        await result.current.handleCheckForUpdates("automatic");
      });
      expect(result.current.preparedUpdateVersion).toBe("1.11.6");
      for (let index = 1; index <= 8; index += 1) {
        rerender({ nonce: index });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_000);
        });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(getIdleSeconds).toHaveBeenCalled();
      expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update", { silent: true });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart when canSafelyRestart returns false", async () => {
    vi.useFakeTimers();
    try {
      const next = update("1.11.6");
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
        version: "1.11.6",
        policyVersion: 2,
        urgency: "general",
        promptAfterMs: 72 * 60 * 60 * 1000,
        backgroundDownloadEligible: true,
        installBehavior: "next-launch",
        message: null,
      });

      const getIdleSeconds = vi.fn(async () => 20 * 60);
      const canSafelyRestart = vi.fn(() => false);

      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        getIdleSeconds,
        canSafelyRestart,
      }));

      await act(async () => {
        await result.current.handleCheckForUpdates("automatic");
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(restartInvocations()).toHaveLength(0);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts silently after 3 idle minutes when the window is hidden", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      const next = update("1.11.6");
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
        version: "1.11.6",
        policyVersion: 2,
        urgency: "general",
        promptAfterMs: 72 * 60 * 60 * 1000,
        backgroundDownloadEligible: true,
        installBehavior: "next-launch",
        message: null,
      });

      const getIdleSeconds = vi.fn(async () => 3 * 60);
      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        getIdleSeconds,
        canSafelyRestart: () => true,
      }));

      await act(async () => {
        await result.current.handleCheckForUpdates("automatic");
      });
      expect(result.current.preparedUpdateVersion).toBe("1.11.6");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update", { silent: true });
      expect(localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBeNull();
      unmount();
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      vi.useRealTimers();
    }
  });

  it("does not restart when idle seconds are unknown", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      const next = update("1.11.6");
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
        version: "1.11.6",
        policyVersion: 2,
        urgency: "general",
        promptAfterMs: 72 * 60 * 60 * 1000,
        backgroundDownloadEligible: true,
        installBehavior: "next-launch",
        message: null,
      });

      const getIdleSeconds = vi.fn(async () => null);
      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        getIdleSeconds,
        canSafelyRestart: () => true,
      }));

      await act(async () => {
        await result.current.handleCheckForUpdates("automatic");
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      });
      expect(restartInvocations()).toHaveLength(0);
      unmount();
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      vi.useRealTimers();
    }
  });

  it("hands a prepared update back to normal prompting when the idle probe never answers", async () => {
    vi.useFakeTimers();
    try {
      const next = update("1.11.6");
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
        version: "1.11.6",
        policyVersion: 2,
        urgency: "general",
        promptAfterMs: 72 * 60 * 60 * 1000,
        backgroundDownloadEligible: true,
        installBehavior: "next-launch",
        message: null,
      });

      const getIdleSeconds = vi.fn(async () => null);
      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        getIdleSeconds,
        canSafelyRestart: () => true,
      }));

      await act(async () => {
        await result.current.handleCheckForUpdates("automatic");
      });
      expect(result.current.preparedUpdateVersion).toBe("1.11.6");
      expect(result.current.canAutoUpdateSilently).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20 * 30_000);
      });
      expect(restartInvocations()).toHaveLength(0);
      expect(result.current.canAutoUpdateSilently).toBe(false);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts immediately on handleInstallUpdate when update is already prepared", async () => {
    const next = update("1.11.6");
    checkMock.mockResolvedValue(next);
    vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce({
      version: "1.11.6",
      policyVersion: 2,
      urgency: "general",
      promptAfterMs: 72 * 60 * 60 * 1000,
      backgroundDownloadEligible: true,
      installBehavior: "next-launch",
      message: null,
    });

    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));
    await act(async () => {
      await result.current.handleCheckForUpdates("automatic");
    });

    expect(result.current.preparedUpdateVersion).toBe("1.11.6");
    invokeMock.mockClear();

    await act(async () => {
      await result.current.handleInstallUpdate();
    });

    expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update", { silent: false });
    expect(localStorage.getItem(POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY)).toBe("1");
  });

  it("exposes canAutoUpdateSilently as false when background preparation has terminally failed", async () => {
    const next = update("1.11.6");
    next.download.mockRejectedValue(new Error("disk read-only"));
    checkMock.mockResolvedValue(next);
    vi.mocked(fetchUpdatePolicy).mockResolvedValue({
      version: "1.11.6",
      policyVersion: 2,
      urgency: "general",
      promptAfterMs: 72 * 60 * 60 * 1000,
      backgroundDownloadEligible: true,
      installBehavior: "next-launch",
      message: null,
    });

    const { result } = renderHook(() => useUpdateController({ backgroundPreparationSupported: true }));

    // Fail 3 times
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });

    expect(result.current.canAutoUpdateSilently).toBe(false);
  });
});
