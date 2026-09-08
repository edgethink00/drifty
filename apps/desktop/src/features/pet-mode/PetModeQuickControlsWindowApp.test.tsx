// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    bridge.listenToNativePetQuickControlsState.mockResolvedValue(vi.fn());
    bridge.setNativePetQuickControlsMenuOpen.mockResolvedValue(undefined);
    nativeMenu.openNativeAutomaticCloseMenu.mockResolvedValue(true);
    nativeMenu.openNativePetModeMenu.mockResolvedValue(true);
  });

  it("refreshes the language when the main window saves the versioned preference", () => {
    render(<PetModeQuickControlsWindowApp />);
    expect(screen.queryByRole("button", { name: "펫 옵션 더 보기" })).toBeNull();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: DISPLAY_LANGUAGE_STORAGE_KEY }));
    });
    expect(screen.getByRole("button", { name: "펫 옵션 더 보기" })).toBeTruthy();
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
      presenceMode: "always",
    });
    const overflowActions = nativeMenu.openNativePetModeMenu.mock.calls[0][0];
    act(() => {
      overflowActions.onOpenDashboard();
      overflowActions.onOpenSettings();
    });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openDashboard");
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("openSettings");
  });

  it("hides the pet before acknowledging the one-hour hide", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    render(<PetModeQuickControlsWindowApp />);

    fireEvent.click(screen.getByRole("button", { name: "펫 1시간 숨김" }));
    fireEvent.click(screen.getByRole("button", { name: "펫 1시간 숨김" }));

    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledWith("hideOneHour", {
      keepQuickControlsVisible: true,
    });
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByText("펫 1시간 숨김 · 자동 닫기 일시정지").length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain("펫 1시간 숨김 · 자동 닫기 일시정지");
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_099);
    });
    expect(bridge.triggerNativePetQuickControlsAction).not.toHaveBeenCalledWith("acknowledgeDismiss");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("acknowledgeDismiss");
  });

  it("never shows success and keeps the panel open with retry when hiding fails", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    bridge.triggerNativePetVisibilityAction.mockRejectedValueOnce(new Error("native failed"));
    render(<PetModeQuickControlsWindowApp />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "펫 1시간 숨김" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("alert").textContent).toContain("바꾸지 못했어요");
    expect(screen.queryByText("펫 1시간 숨김 · 자동 닫기 일시정지")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      await Promise.resolve();
    });
    expect(screen.getAllByText("펫 1시간 숨김 · 자동 닫기 일시정지").length).toBeGreaterThan(0);
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("acknowledgeDismiss");
  });

  it("starts the hide acknowledgement timer after the native hide finishes", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    let finishHide!: () => void;
    bridge.triggerNativePetVisibilityAction.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishHide = resolve;
    }));
    render(<PetModeQuickControlsWindowApp />);
    fireEvent.click(screen.getByRole("button", { name: "Hide pet 1h" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(screen.queryByText("Pet hidden for 1h · Auto-close paused")).toBeNull();
    expect(bridge.triggerNativePetQuickControlsAction).not.toHaveBeenCalledWith("acknowledgeDismiss");

    await act(async () => { finishHide(); });
    expect(screen.getByRole("status").textContent).toContain("Pet hidden for 1h · Auto-close paused");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_099); });
    expect(bridge.triggerNativePetQuickControlsAction).not.toHaveBeenCalledWith("acknowledgeDismiss");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledExactlyOnceWith("acknowledgeDismiss");
  });

  it("does not extend the hide acknowledgement when native state or pointer events arrive", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    render(<PetModeQuickControlsWindowApp />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "펫 1시간 숨김" }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const listenerCalls = bridge.listenToNativePetQuickControlsState.mock.calls;
    const onState = listenerCalls[listenerCalls.length - 1]?.[0];
    act(() => {
      onState?.({
        automaticCloseEnabled: false,
        automaticCloseSavedEnabled: true,
        automaticCloseOverride: { enabled: false, kind: "60", endsAtMs: Date.now() + 3_600_000 },
        language: "en",
        theme: "dark",
      });
      fireEvent.mouseLeave(screen.getByRole("status"));
      fireEvent.mouseEnter(screen.getByRole("status"));
    });
    expect(screen.getByRole("status").textContent).toContain("Pet hidden for 1h · Auto-close paused");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(bridge.triggerNativePetQuickControlsAction).not.toHaveBeenCalledWith("acknowledgeDismiss");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledExactlyOnceWith("acknowledgeDismiss");
  });

  it("cancels the acknowledgement timer when the controls unmount", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    const { unmount } = render(<PetModeQuickControlsWindowApp />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide pet 1h" }));
    });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(bridge.triggerNativePetQuickControlsAction).not.toHaveBeenCalledWith("acknowledgeDismiss");
  });

  it("handles a failed acknowledgement dismissal without replaying the hide", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    bridge.triggerNativePetQuickControlsAction.mockRejectedValueOnce(new Error("dismiss failed"));
    render(<PetModeQuickControlsWindowApp />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide pet 1h" }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledExactlyOnceWith("acknowledgeDismiss");
    expect(bridge.triggerNativePetVisibilityAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Pet hidden for 1h · Auto-close paused")).toBeNull();
  });

  it("keeps the confirmation text until native dismissal finishes, even after pointer leave", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "en");
    let finishDismiss!: () => void;
    bridge.triggerNativePetQuickControlsAction.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDismiss = resolve;
    }));
    render(<PetModeQuickControlsWindowApp />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide pet 1h" }));
    });
    fireEvent.pointerLeave(screen.getByRole("toolbar"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_099); });
    expect(bridge.triggerNativePetQuickControlsAction).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Pet hidden for 1h");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("acknowledgeDismiss");
    // The renderer must not replace the text with buttons while the native
    // panel is still fading out, including a delayed final AppKit frame.
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole("status").textContent).toContain("Pet hidden for 1h");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    await act(async () => { finishDismiss(); });
    expect(screen.queryByRole("status")).toBeNull();
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

  it("retries the exact native menu that failed to open", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    nativeMenu.openNativePetModeMenu
      .mockRejectedValueOnce(new Error("menu failed"))
      .mockResolvedValueOnce(true);
    render(<PetModeQuickControlsWindowApp />);

    fireEvent.click(screen.getByRole("button", { name: "펫 옵션 더 보기" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("바꾸지 못했어요"));

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(nativeMenu.openNativePetModeMenu).toHaveBeenCalledTimes(2));
    expect(nativeMenu.openNativeAutomaticCloseMenu).not.toHaveBeenCalled();
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
    expect(screen.getByRole("button", { name: /자동 닫기: .*까지/ })).toBeTruthy();
    expect(screen.getByText("멈춤")).toBeTruthy();
    expect(screen.queryByText(/까지$/)).toBeNull();
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

    await waitFor(() => expect(screen.getByRole("button", { name: /자동 닫기: .*까지/ })).toBeTruthy());
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

  it("shows the selected resume time after pausing auto-close", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-05T15:27:00+09:00"));
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, "1");
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, "1");
    render(<PetModeQuickControlsWindowApp />);
    await waitFor(() => expect(bridge.listenToNativePetQuickControlsState).toHaveBeenCalled());
    const listenerCalls = bridge.listenToNativePetQuickControlsState.mock.calls;
    const onState = listenerCalls[listenerCalls.length - 1]?.[0];
    fireEvent.click(screen.getByRole("button", { name: "자동 닫기: 켬" }));
    await waitFor(() => expect(nativeMenu.openNativeAutomaticCloseMenu).toHaveBeenCalled());
    const onAction = nativeMenu.openNativeAutomaticCloseMenu.mock.calls[0][0];
    act(() => {
      onAction("automaticClosePause15");
    });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("automaticClosePause15");
    act(() => {
      onState?.({
        automaticCloseEnabled: false,
        automaticCloseSavedEnabled: true,
        automaticCloseOverride: { enabled: false, kind: "15", endsAtMs: Date.now() + 15 * 60_000 },
        language: "ko",
        theme: "light",
      });
    });
    expect(screen.queryByRole("button", { name: "자동 닫기: 켬" })).toBeNull();
    expect(screen.getAllByText(/까지 멈췄어요$/).length).toBeGreaterThan(0);
    let finishDismiss!: () => void;
    bridge.triggerNativePetQuickControlsAction.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDismiss = resolve;
    }));
    fireEvent.pointerLeave(screen.getByRole("toolbar"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_099);
    });
    expect(screen.getByRole("status").textContent).toMatch(/까지 멈췄어요$/);
    expect(bridge.triggerNativePetQuickControlsAction).not.toHaveBeenCalledWith("acknowledgeDismiss");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(bridge.triggerNativePetQuickControlsAction).toHaveBeenCalledWith("acknowledgeDismiss");
    expect(screen.getByRole("status").textContent).toMatch(/까지 멈췄어요$/);
    await act(async () => { finishDismiss(); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a recoverable failure when native state does not confirm a pause in time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, "1");
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, "1");
    render(<PetModeQuickControlsWindowApp />);
    await waitFor(() => expect(bridge.listenToNativePetQuickControlsState).toHaveBeenCalled());
    const listenerCalls = bridge.listenToNativePetQuickControlsState.mock.calls;
    const onState = listenerCalls[listenerCalls.length - 1]?.[0];

    fireEvent.click(screen.getByRole("button", { name: "자동 닫기: 켬" }));
    await waitFor(() => expect(nativeMenu.openNativeAutomaticCloseMenu).toHaveBeenCalled());
    act(() => {
      nativeMenu.openNativeAutomaticCloseMenu.mock.calls[0][0]("automaticClosePause15");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("alert").textContent).toContain("바꾸지 못했어요");

    act(() => {
      onState?.({
        automaticCloseEnabled: false,
        automaticCloseSavedEnabled: true,
        automaticCloseOverride: { enabled: false, kind: "15", endsAtMs: Date.now() + 15 * 60_000 },
        language: "ko",
        theme: "light",
      });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText(/까지 멈췄어요$/).length).toBeGreaterThan(0);
  });

  it("keeps the bar open and shows a visible failure when pause dispatch fails", async () => {
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, "1");
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, "1");
    bridge.triggerNativePetQuickControlsAction.mockRejectedValueOnce(new Error("native failed"));
    render(<PetModeQuickControlsWindowApp />);
    fireEvent.click(screen.getByRole("button", { name: "자동 닫기: 켬" }));
    await waitFor(() => expect(nativeMenu.openNativeAutomaticCloseMenu).toHaveBeenCalled());
    const onAction = nativeMenu.openNativeAutomaticCloseMenu.mock.calls[0][0];
    await act(async () => {
      onAction("automaticClosePause15");
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toContain("바꾸지 못했어요");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });
});
