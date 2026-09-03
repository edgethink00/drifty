// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXTREME_NUDGE_STORAGE_KEY } from "../companion/extremeNudgeData";
import { DRIFT_ALERTS_STORAGE_KEY } from "../companion/driftAlarmData";
import { AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY } from "../companion/automaticCloseOverride";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "../localization/languagePreference";
import { THEME_STORAGE_KEY } from "../settings/settingsStorage";
import { PetModeQuickControlsWindowApp } from "./PetModeQuickControlsWindowApp";

const bridge = vi.hoisted(() => ({
  listenToNativePetQuickControlsState: vi.fn().mockResolvedValue(vi.fn()),
  triggerNativePetQuickControlsAction: vi.fn().mockResolvedValue(undefined),
  triggerNativePetVisibilityAction: vi.fn().mockResolvedValue(undefined),
  setNativePetQuickControlsMenuOpen: vi.fn().mockResolvedValue(undefined),
}));
const nativeMenu = vi.hoisted(() => ({
  openNativeAutomaticCloseMenu: vi.fn().mockResolvedValue(true),
  openNativePetModeMenu: vi.fn().mockResolvedValue(true),
}));

vi.mock("./petModeBridge", () => ({
  listenToNativePetQuickControlsState: bridge.listenToNativePetQuickControlsState,
  triggerNativePetQuickControlsAction: bridge.triggerNativePetQuickControlsAction,
  triggerNativePetVisibilityAction: bridge.triggerNativePetVisibilityAction,
  setNativePetQuickControlsMenuOpen: bridge.setNativePetQuickControlsMenuOpen,
}));

vi.mock("./petModeNativeMenu", () => ({
  openNativeAutomaticCloseMenu: nativeMenu.openNativeAutomaticCloseMenu,
  openNativePetModeMenu: nativeMenu.openNativePetModeMenu,
}));

describe("PetModeQuickControlsWindowApp", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    bridge.listenToNativePetQuickControlsState.mockResolvedValue(vi.fn());
    bridge.setNativePetQuickControlsMenuOpen.mockResolvedValue(undefined);
    nativeMenu.openNativeAutomaticCloseMenu.mockResolvedValue(true);
    nativeMenu.openNativePetModeMenu.mockResolvedValue(true);
  });

  it("opens the timed automatic-close menu and the native overflow menu", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, "1");
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, "1");
    render(<PetModeQuickControlsWindowApp />);

    fireEvent.click(screen.getByRole("button", { name: "자동 닫기: 켬" }));
    await waitFor(() => expect(nativeMenu.openNativeAutomaticCloseMenu).toHaveBeenCalledWith(
      expect.any(Function),
      { savedEnabled: true, override: null, language: "ko" },
    ));

    fireEvent.click(screen.getByRole("button", { name: "펫 1시간 숨김" }));
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledWith("hideOneHour");

    fireEvent.click(screen.getByRole("button", { name: "펫 옵션 더 보기" }));
    await waitFor(() => expect(nativeMenu.openNativePetModeMenu).toHaveBeenCalledTimes(1));
    expect(bridge.setNativePetQuickControlsMenuOpen.mock.calls).toEqual([
      [true],
      [false],
      [true],
      [false],
    ]);
    expect(nativeMenu.openNativePetModeMenu.mock.calls[0][1]).toEqual({
      language: "ko",
    });
    const overflowActions = nativeMenu.openNativePetModeMenu.mock.calls[0][0];
    overflowActions.onOpenDashboard();
    overflowActions.onOpenSettings();
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openDashboard");
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openSettings");
  });

  it("keeps native menu presentation single-flight across rapid clicks", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    let closeMenu!: (value: boolean) => void;
    nativeMenu.openNativeAutomaticCloseMenu.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      closeMenu = resolve;
    }));
    render(<PetModeQuickControlsWindowApp />);

    const automaticClose = screen.getByRole("button", { name: "Auto-close: Off" });
    fireEvent.click(automaticClose);
    await waitFor(() => expect(nativeMenu.openNativeAutomaticCloseMenu).toHaveBeenCalledTimes(1));
    fireEvent.click(automaticClose);
    fireEvent.click(screen.getByRole("button", { name: "More pet options" }));

    expect(nativeMenu.openNativeAutomaticCloseMenu).toHaveBeenCalledTimes(1);
    expect(nativeMenu.openNativePetModeMenu).not.toHaveBeenCalled();
    await act(async () => {
      closeMenu(true);
      await Promise.resolve();
    });
    expect(bridge.setNativePetQuickControlsMenuOpen.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps the English bar labels on one line", () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, "0");
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, "0");
    render(<PetModeQuickControlsWindowApp />);

    expect(screen.getByRole("button", { name: "Auto-close: Off" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide pet 1h" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More pet options" })).toBeTruthy();
  });

  it("keeps a temporary English activation compact while preserving its accessible state", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    render(<PetModeQuickControlsWindowApp />);
    await waitFor(() => expect(bridge.listenToNativePetQuickControlsState).toHaveBeenCalled());
    const listenerCalls = bridge.listenToNativePetQuickControlsState.mock.calls;
    const onState = listenerCalls[listenerCalls.length - 1]?.[0];

    act(() => {
      onState?.({
        automaticCloseEnabled: true,
        automaticCloseSavedEnabled: false,
        automaticCloseOverride: { enabled: true, kind: "15", endsAtMs: Date.now() + 15 * 60_000 },
        language: "en",
        theme: "dark",
      });
    });

    const stateButton = screen.getByRole("button", { name: "Auto-close: Temporarily on" });
    expect(stateButton.textContent).toContain("On");
    expect(stateButton.textContent).not.toContain("Temporarily on");
  });

  it("applies native theme updates without requiring a language change", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<PetModeQuickControlsWindowApp />);

    expect(document.documentElement.dataset.theme).toBe("light");
    await waitFor(() => expect(bridge.listenToNativePetQuickControlsState).toHaveBeenCalled());
    const listenerCalls = bridge.listenToNativePetQuickControlsState.mock.calls;
    const onState = listenerCalls[listenerCalls.length - 1]?.[0];

    act(() => {
      onState?.({
        automaticCloseEnabled: false,
        automaticCloseSavedEnabled: true,
        automaticCloseOverride: { enabled: false, kind: "15", endsAtMs: Date.now() + 15 * 60_000 },
        language: "ko",
        theme: "dark",
      });
    });

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(screen.getByRole("button", { name: "자동 닫기: 멈춤" })).toBeTruthy();
    expect(screen.getByText("멈춤")).toBeTruthy();
    expect(screen.queryByText(/15분/)).toBeNull();
  });

  it("does not render a stale paused state from an already-expired native event", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    render(<PetModeQuickControlsWindowApp />);
    await waitFor(() => expect(bridge.listenToNativePetQuickControlsState).toHaveBeenCalled());
    const listenerCalls = bridge.listenToNativePetQuickControlsState.mock.calls;
    const onState = listenerCalls[listenerCalls.length - 1]?.[0];

    act(() => {
      onState?.({
        automaticCloseEnabled: true,
        automaticCloseSavedEnabled: true,
        automaticCloseOverride: { enabled: false, kind: "15", endsAtMs: Date.now() - 1 },
        language: "en",
        theme: "light",
      });
    });

    expect(screen.getByRole("button", { name: "Auto-close: On" })).toBeTruthy();
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("refreshes a persisted override if the native state event was missed", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, "1");
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, "1");
    render(<PetModeQuickControlsWindowApp />);

    window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify({
      enabled: false,
      kind: "15",
      startedAtMs: Date.now(),
      endsAtMs: Date.now() + 15 * 60_000,
    }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY,
      }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "자동 닫기: 멈춤" })).toBeTruthy());
  });

  it("releases a listener that finishes registering after unmount", async () => {
    let finishListening: ((unlisten: () => void) => void) | null = null;
    const unlisten = vi.fn();
    bridge.listenToNativePetQuickControlsState.mockImplementationOnce(() => new Promise((resolve) => {
      finishListening = resolve;
    }));
    const { unmount } = render(<PetModeQuickControlsWindowApp />);

    unmount();
    await act(async () => {
      finishListening?.(unlisten);
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledOnce();
  });
});
