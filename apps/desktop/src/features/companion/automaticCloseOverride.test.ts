// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY,
  automaticCloseOverrideIsExpired,
  buildAutomaticCloseOverride,
  extendAutomaticCloseOverride,
  persistAutomaticCloseOverride,
  resolveEffectiveAutomaticCloseEnabled,
  resolveInitialAutomaticCloseOverride,
  sendAutomaticCloseOverrideExpiredNotification,
} from "./automaticCloseOverride";

const notification = vi.hoisted(() => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

vi.mock("@tauri-apps/plugin-notification", () => notification);

describe("automatic-close override", () => {
  beforeEach(() => {
    window.localStorage.clear();
    notification.isPermissionGranted.mockReset().mockResolvedValue(true);
    notification.requestPermission.mockReset().mockResolvedValue("granted");
    notification.sendNotification.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("persists a timed pause without changing the saved setting", () => {
    const pause = buildAutomaticCloseOverride(false, "15", 1_000);
    persistAutomaticCloseOverride(pause);

    expect(resolveInitialAutomaticCloseOverride(900_999)).toEqual({
      enabled: false,
      kind: "15",
      startedAtMs: 1_000,
      endsAtMs: 901_000,
    });
    expect(resolveEffectiveAutomaticCloseEnabled(true, pause, 900_999)).toBe(false);
    expect(resolveEffectiveAutomaticCloseEnabled(true, pause, 901_000)).toBe(true);
  });

  it("removes malformed persisted state instead of applying it", () => {
    window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify({ enabled: false, kind: "15" }));

    expect(resolveInitialAutomaticCloseOverride()).toBeNull();
    expect(window.localStorage.getItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY)).toBeNull();
  });

  it("clears an expired persisted override instead of flashing stale state after restart", () => {
    const expiredPause = buildAutomaticCloseOverride(false, "15", 1_000);
    window.localStorage.setItem(
      AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY,
      JSON.stringify(expiredPause),
    );

    expect(resolveInitialAutomaticCloseOverride(expiredPause.endsAtMs ?? 0)).toBeNull();
    expect(window.localStorage.getItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY)).toBeNull();
  });

  it("extends from the current deadline and supports a non-expiring override", () => {
    const pause = buildAutomaticCloseOverride(false, "15", 1_000);
    const extended = extendAutomaticCloseOverride(pause, "60", 2_000);
    const forever = buildAutomaticCloseOverride(false, "forever", 3_000);

    expect(extended.endsAtMs).toBe(4_501_000);
    expect(automaticCloseOverrideIsExpired(extended, 4_501_000)).toBe(true);
    expect(forever.endsAtMs).toBeNull();
    expect(automaticCloseOverrideIsExpired(forever, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("uses the existing permission or requests it before notifying", async () => {
    const pause = buildAutomaticCloseOverride(false, "15", 1_000);

    await expect(sendAutomaticCloseOverrideExpiredNotification(pause, true, "ko")).resolves.toBe(true);
    expect(notification.requestPermission).not.toHaveBeenCalled();
    expect(notification.sendNotification).toHaveBeenCalledWith({
      title: "자동 닫기가 다시 켜졌어요",
      body: "15분 일시 중지가 끝나 저장된 설정으로 돌아왔습니다.",
    });

    notification.isPermissionGranted.mockResolvedValueOnce(false);
    await expect(sendAutomaticCloseOverrideExpiredNotification(pause, true, "ko")).resolves.toBe(true);
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(notification.sendNotification).toHaveBeenCalledTimes(2);

    notification.isPermissionGranted.mockResolvedValueOnce(false);
    notification.requestPermission.mockResolvedValueOnce("denied");
    await expect(sendAutomaticCloseOverrideExpiredNotification(pause, true, "ko")).resolves.toBe(false);
    expect(notification.sendNotification).toHaveBeenCalledTimes(2);
  });
});
