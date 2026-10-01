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
import { useUpdateController, WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY } from "./useUpdateController";
import { POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY, fetchUpdatePolicy, fallbackUpdatePolicy } from "./updatePolicy";
import { WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY } from "./useAutomaticUpdateScheduler";
import { BUILD_INFO } from "../../buildInfo";
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
  await waitFor(() => expect(fetchUpdatePolicy).toHaveBeenCalledWith(
    "1.11.0",
    expect.any(Function),
    "other",
  ));
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

describe("Windows unattended stable update", () => {
  const [major, minor, patch] = BUILD_INFO.version.split(".");
  const candidateVersion = (offset: number) => `${major}.${minor}.${Number(patch) + offset}`;
  const windowsPolicy = {
    version: candidateVersion(1),
    policyVersion: 2 as const,
    urgency: "general" as const,
    promptAfterMs: 72 * 60 * 60 * 1000,
    backgroundDownloadEligible: true,
    installBehavior: "idle" as const,
    message: null,
  };

  it("lets a manual Windows update launch NSIS without an app-side relaunch", async () => {
    const next = update(windowsPolicy.version);
    checkMock.mockResolvedValue(next);
    const { result } = renderHook(() => useUpdateController({
      backgroundPreparationSupported: true,
      hostPlatform: "windows",
    }));
    await act(async () => { await result.current.handleCheckForUpdates("manual"); });
    await act(async () => { await result.current.handleInstallUpdate(); });
    expect(invokeMock).toHaveBeenCalledWith("windows_download_stable_update", { expectedVersion: windowsPolicy.version });
    expect(invokeMock).toHaveBeenCalledWith("windows_install_prepared_stable_update", { expectedVersion: windowsPolicy.version, silent: false });
    expect(next.downloadAndInstall).not.toHaveBeenCalled();
    expect(restartInvocations()).toHaveLength(0);
  });

  it("downloads first and launches NSIS only after a safe idle probe", async () => {
    vi.useFakeTimers();
    try {
      const next = update(windowsPolicy.version);
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy);
      let idleSeconds = 30;
      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        hostPlatform: "windows",
        getIdleSeconds: async () => idleSeconds,
        canSafelyRestart: () => true,
      }));
      await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
      expect(invokeMock).toHaveBeenCalledWith("windows_download_stable_update", { expectedVersion: windowsPolicy.version });
      expect(invokeMock).not.toHaveBeenCalledWith("windows_install_prepared_stable_update", expect.anything());
      expect(result.current.shouldShowAvailableUpdateDialog).toBe(false);
      expect(result.current.canAutoUpdateSilently).toBe(true);
      expect(localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)).toBe(windowsPolicy.version);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(invokeMock).not.toHaveBeenCalledWith("windows_install_prepared_stable_update", expect.anything());
      idleSeconds = 15 * 60 + 1;
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(invokeMock).toHaveBeenCalledWith("windows_install_prepared_stable_update", { expectedVersion: windowsPolicy.version, silent: true });
      expect(restartInvocations()).toHaveLength(0);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])("installs the prepared Windows candidate after a manual check fails (retry: %s)", async (retry) => {
    vi.useFakeTimers();
    try {
      checkMock.mockReset();
      const prepared = update(windowsPolicy.version);
      const rechecked = update(windowsPolicy.version);
      checkMock.mockResolvedValueOnce(prepared)
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(rechecked);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy);
      let idleSeconds = 30;
      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        hostPlatform: "windows",
        getIdleSeconds: async () => idleSeconds,
        canSafelyRestart: () => true,
      }));
      await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
      await act(async () => {
        expect(await result.current.handleCheckForUpdates("manual")).toEqual({ kind: "error", message: "Update check failed: offline" });
      });
      expect(result.current.updaterError).toBe("Update check failed: offline");
      expect(result.current.preparedUpdateVersion).toBe(windowsPolicy.version);
      expect(localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)).toBe(windowsPolicy.version);
      if (retry) {
        await act(async () => {
          expect(await result.current.handleCheckForUpdates("manual")).toEqual({ kind: "available", version: windowsPolicy.version });
        });
        expect(rechecked.close).toHaveBeenCalledOnce();
      }
      expect(result.current.shouldShowAvailableUpdateDialog).toBe(false);
      idleSeconds = 960;
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(invokeMock.mock.calls.filter(([command]) => command === "windows_install_prepared_stable_update"))
        .toEqual([["windows_install_prepared_stable_update", { expectedVersion: windowsPolicy.version, silent: true }]]);
      expect(result.current.availableUpdate).toBe(prepared);
      expect(result.current.currentUpdatePolicy).toEqual(windowsPolicy);
      expect(prepared.close).not.toHaveBeenCalled();
      expect(invokeMock.mock.calls.filter(([command]) => command === "windows_download_stable_update")).toHaveLength(1);
      expect(invokeMock).not.toHaveBeenCalledWith("windows_clear_prepared_stable_update");
      expect(restartInvocations()).toHaveLength(0);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restages the same signed Windows candidate after a normal quit", async () => {
    checkMock.mockImplementation(async () => update(windowsPolicy.version));
    vi.mocked(fetchUpdatePolicy).mockResolvedValue(windowsPolicy);
    const first = renderHook(() => useUpdateController({
      backgroundPreparationSupported: true,
      hostPlatform: "windows",
    }));
    await act(async () => { await first.result.current.handleCheckForUpdates("automatic"); });
    expect(localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)).toBe(windowsPolicy.version);
    first.unmount();

    const second = renderHook(() => useUpdateController({
      backgroundPreparationSupported: true,
      hostPlatform: "windows",
    }));
    await act(async () => { await second.result.current.handleCheckForUpdates("automatic"); });
    expect(invokeMock.mock.calls.filter(([command]) => command === "windows_download_stable_update")).toHaveLength(2);
    expect(second.result.current.preparedUpdateVersion).toBe(windowsPolicy.version);
    expect(second.result.current.shouldShowAvailableUpdateDialog).toBe(false);
  });

  it("drops a stale pending marker when restaging is no longer eligible", async () => {
    localStorage.setItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY, windowsPolicy.version);
    checkMock.mockResolvedValue(update(windowsPolicy.version));
    vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(fallbackUpdatePolicy(windowsPolicy.version));
    const { result } = renderHook(() => useUpdateController({
      backgroundPreparationSupported: true,
      hostPlatform: "windows",
    }));
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    expect(localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("windows_download_stable_update", expect.anything());
  });

  it("clears a stale pending marker after a failed restage", async () => {
    localStorage.setItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY, windowsPolicy.version);
    checkMock.mockResolvedValue(update(windowsPolicy.version));
    vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "windows_download_stable_update") throw new Error("network interrupted");
    });
    const { result } = renderHook(() => useUpdateController({
      backgroundPreparationSupported: true,
      hostPlatform: "windows",
    }));
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    expect(localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)).toBeNull();
    expect(result.current.updaterError).toContain("network interrupted");
  });

  it("drops a prepared stable package when Windows enters the beta channel", async () => {
    const next = update(windowsPolicy.version);
    checkMock.mockResolvedValue(next);
    vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy);
    const { result, rerender } = renderHook(
      ({ stableEnabled }: { stableEnabled: boolean }) => useUpdateController({
        backgroundPreparationSupported: true,
        hostPlatform: "windows",
        stableAutomaticUpdatesEnabled: stableEnabled,
      }),
      { initialProps: { stableEnabled: true } },
    );
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    rerender({ stableEnabled: false });
    expect(result.current.preparedUpdateVersion).toBeNull();
    expect(next.close).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("windows_clear_prepared_stable_update");
    expect(localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)).toBeNull();
  });

  it("keeps a manual recovery path when the idle installer fails", async () => {
    vi.useFakeTimers();
    try {
      const next = update(windowsPolicy.version);
      invokeMock.mockImplementation(async (command: string) => {
        if (command === "windows_install_prepared_stable_update") throw new Error("installer launch refused");
      });
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy);
      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        hostPlatform: "windows",
        getIdleSeconds: async () => 16 * 60,
      }));
      await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(result.current.availableUpdateSource).toBe("manual");
      expect(result.current.updaterError).toContain("installer launch refused");
      expect(result.current.shouldShowAvailableUpdateDialog).toBe(true);
      expect(localStorage.getItem(WINDOWS_PENDING_AUTO_UPDATE_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY)).toBe(windowsPolicy.version);
      expect(restartInvocations()).toHaveLength(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps manual recovery reachable after Later when a failed installer relaunches the old version", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY, windowsPolicy.version);
      const next = update(windowsPolicy.version);
      checkMock.mockResolvedValue(next);
      vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy);
      const { result, unmount } = renderHook(() => useUpdateController({
        backgroundPreparationSupported: true,
        hostPlatform: "windows",
        getIdleSeconds: async () => 960,
        canSafelyRestart: () => true,
      }));
      await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
      expect(result.current.shouldShowAvailableUpdateDialog).toBe(true);
      expect(result.current.updaterError).toContain("Install it manually");
      act(() => result.current.dismissAvailableUpdate());
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(result.current.shouldShowAvailableUpdateDialog).toBe(false);
      expect(result.current.availableUpdate).toBe(next);
      expect(result.current.availableUpdateSource).toBe("automatic");
      expect(result.current.preparedUpdateVersion).toBeNull();
      expect(result.current.canAutoUpdateSilently).toBe(false);
      expect(result.current.updaterError).toContain("Install it manually");
      expect(invokeMock).not.toHaveBeenCalledWith("windows_download_stable_update", expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith("windows_install_prepared_stable_update", expect.anything());
      await act(async () => { await result.current.handleInstallUpdate(); });
      expect(invokeMock).toHaveBeenCalledWith("windows_download_stable_update", { expectedVersion: windowsPolicy.version });
      expect(invokeMock).toHaveBeenCalledWith("windows_install_prepared_stable_update", { expectedVersion: windowsPolicy.version, silent: false });
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows a newer Windows candidate to prepare silently after failed-version recovery is dismissed", async () => {
    localStorage.setItem(WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY, windowsPolicy.version);
    const newerVersion = candidateVersion(2);
    checkMock.mockResolvedValueOnce(update(windowsPolicy.version)).mockResolvedValueOnce(update(newerVersion));
    vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy)
      .mockResolvedValueOnce({ ...windowsPolicy, version: newerVersion });
    const { result } = renderHook(() => useUpdateController({
      backgroundPreparationSupported: true,
      hostPlatform: "windows",
    }));
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    act(() => result.current.dismissAvailableUpdate());
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    expect(invokeMock.mock.calls.filter(([command]) => command === "windows_download_stable_update"))
      .toEqual([["windows_download_stable_update", { expectedVersion: newerVersion }]]);
    expect(result.current.preparedUpdateVersion).toBe(newerVersion);
    expect(result.current.shouldShowAvailableUpdateDialog).toBe(false);
    expect(result.current.canAutoUpdateSilently).toBe(true);
  });

  it("never launches NSIS when native signature validation rejects the download", async () => {
    const next = update(windowsPolicy.version);
    checkMock.mockResolvedValue(next);
    vi.mocked(fetchUpdatePolicy).mockResolvedValueOnce(windowsPolicy);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "windows_download_stable_update") throw new Error("signature mismatch");
    });
    const { result } = renderHook(() => useUpdateController({
      backgroundPreparationSupported: true,
      hostPlatform: "windows",
    }));
    await act(async () => { await result.current.handleCheckForUpdates("automatic"); });
    expect(result.current.updaterError).toContain("signature mismatch");
    expect(invokeMock).not.toHaveBeenCalledWith("windows_install_prepared_stable_update", expect.anything());
    expect(localStorage.getItem(WINDOWS_INSTALL_ATTEMPT_STORAGE_KEY)).toBeNull();
  });
});
