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
function update(version = "1.10.9") {
  return { version, body: null, close: vi.fn().mockResolvedValue(undefined), download: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined), downloadAndInstall: vi.fn().mockResolvedValue(undefined) };
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
    expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update");
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
  expect(invokeMock).toHaveBeenCalledWith("app_restart_after_update");
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
