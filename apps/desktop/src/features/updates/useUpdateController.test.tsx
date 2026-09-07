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
import { useUpdateController } from "./useUpdateController";
import { POST_UPDATE_RELAUNCH_FOCUS_STORAGE_KEY } from "./updatePolicy";
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
